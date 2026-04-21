import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { parseUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  getAddress,
  http,
  type Hex,
} from 'viem';
import { polygon } from 'viem/chains';

import {
  constants,
  createKernelAccount,
  createKernelAccountClient,
  getERC20PaymasterApproveCall,
} from '@zerodev/sdk';
import { getUserOperationGasPrice } from '@zerodev/sdk/actions';

dotenv.config({
  path: path.resolve(process.cwd(), '.env'),
});

type SponsorshipMode = 'unsponsored' | 'verifying' | 'erc20';

type PrepareApiResponse = {
  stage?: string;
  sponsorEnabled?: boolean;
  sponsorType?: 'verifying' | 'erc20';
  requestedFrom?: string;
  actualSignerAddress?: string;
  kernelAccountAddress?: string;
  call?: {
    to: string;
    data: Hex;
    value: string;
  };
  userOp?: Record<string, any>;
  unsignedUserOp?: {
    userOp?: Record<string, any>;
    kernelAccountAddress?: string;
  };
  note?: string;
};

type SubmitApiResponse = {
  chainId?: number;
  userOpHash: string | null;
  txHash: string | null;
  error?: string;
};

type CompareRow = {
  runIndex: number;
  timestamp: string;
  mode: SponsorshipMode;
  sender: string;
  txHash: string;
  userOpHash: string;
  prepareLatencyMs: number;
  submitToLandMs: number;
  totalWallClockMs: number;
  gasUsed: string;
  effectiveGasPriceWei: string;
  actualFeeWei: string;
  actualFeeNative: number;
  actualFeeUSD: number;
  userPaysWei: string;
  userPaysNative: number;
  userPaysUSDC: number;
  userPaysUSD: number;
  sponsorPaysWei: string;
  sponsorPaysNative: number;
  sponsorPaysUSD: number;
  success: boolean;
  error: string;
};

const CHAIN_ID = 137;
const ENTRYPOINT = constants.getEntryPoint('0.7');
const KERNEL_VERSION = constants.KERNEL_V3_3;

// Hard-coded FX for comparison (edit if you want)
const POL_USD = Number(process.env.POL_USD_PRICE ?? '0.70');
const USDC_USD = Number(process.env.USDC_USD_PRICE ?? '1.00');

// Gas token used by ERC20 sponsorship on Polygon
const ERC20_TOKEN = getAddress(
  process.env.COMPARE_ERC20_TOKEN ??
    '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
);
const USDC_DECIMALS = 6;

const MINIMAL_CALL_DATA = '0x' as Hex;
const MINIMAL_CALL_VALUE = 0n;

const RUN_COUNT = Number(process.env.RUN_COUNT ?? '3');
const DELAY_MS = Number(process.env.DELAY_MS ?? '5000');

const RESULTS_CSV = path.resolve(
  process.cwd(),
  process.env.RESULTS_CSV ?? 'compare_polygon_sponsorships.csv',
);
const SUMMARY_CSV = path.resolve(
  process.cwd(),
  process.env.SUMMARY_CSV ?? 'compare_polygon_sponsorships_summary.csv',
);

const API_BASE_URL =
  process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL;
const API_KEY =
  process.env.API_KEY ??
  process.env.X_API_KEY ??
  process.env.NEXT_PUBLIC_API_KEY;
const POLYGON_RPC_URL =
  process.env.POLYGON_RPC_URL ?? process.env.NEXT_PUBLIC_POLYGON_RPC_URL;
const TEST_PRIVATE_KEY = process.env.TEST_PRIVATE_KEY as Hex | undefined;

function normalizeBundlerRpc(value: string | undefined): string {
  if (!value) {
    throw new Error('Missing ZERODEV_RPC in .env');
  }
  if (value.includes('/chain/')) {
    return value;
  }
  return `${value.replace(/\/$/, '')}/chain/${CHAIN_ID}`;
}

const BUNDLER_RPC_URL = normalizeBundlerRpc(
  process.env.ZERODEV_RPC ??
    process.env.ZERODEV_BUNDLER_RPC ??
    process.env.NEXT_PUBLIC_ZERODEV_RPC,
);

if (!API_BASE_URL) {
  throw new Error('Missing API_BASE_URL (or NEXT_PUBLIC_API_BASE_URL) in .env');
}
if (!API_KEY) {
  throw new Error(
    'Missing API_KEY (or X_API_KEY / NEXT_PUBLIC_API_KEY) in .env',
  );
}
if (!POLYGON_RPC_URL) {
  throw new Error(
    'Missing POLYGON_RPC_URL (or NEXT_PUBLIC_POLYGON_RPC_URL) in .env',
  );
}
if (!TEST_PRIVATE_KEY) {
  throw new Error('Missing TEST_PRIVATE_KEY in .env');
}

const account = privateKeyToAccount(TEST_PRIVATE_KEY);

// Same MINIMAL business action for all three modes: zero-value call to an EOA.
// This keeps the comparison focused on sponsorship overhead instead of token balance.
const MINIMAL_CALL_TO = getAddress(process.env.COMPARE_TO ?? account.address);
const chainPublicClient = createPublicClient({
  chain: polygon,
  transport: http(POLYGON_RPC_URL),
});
const bundlerPublicClient = createPublicClient({
  chain: polygon,
  transport: http(BUNDLER_RPC_URL),
});
const walletClient = createWalletClient({
  account,
  chain: polygon,
  transport: http(POLYGON_RPC_URL),
});

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildMinimalUserCall() {
  return {
    to: MINIMAL_CALL_TO,
    data: MINIMAL_CALL_DATA,
    value: MINIMAL_CALL_VALUE,
  } as const;
}

function toHex(value: bigint | number | string | undefined | null): Hex {
  if (value === null || value === undefined) return '0x0';
  if (typeof value === 'string' && value.startsWith('0x')) return value as Hex;
  return `0x${BigInt(value).toString(16)}` as Hex;
}

function toBigIntStrict(
  value: bigint | string | number | undefined | null,
): bigint | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return BigInt(value as any);
}

function calcNativeCostWei(gasUsed: bigint, effectiveGasPrice: bigint) {
  const actualFeeWei = gasUsed * effectiveGasPrice;
  const actualFeeNative = Number(actualFeeWei) / 1e18;
  const actualFeeUSD = actualFeeNative * POL_USD;
  return {
    actualFeeWei,
    actualFeeNative,
    actualFeeUSD,
  };
}

async function rpc(method: string, params: any[]) {
  const response = await fetch(BUNDLER_RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params,
    }),
  });

  const json: any = await response.json();

  if (json.error) {
    throw new Error(
      `RPC ${method} failed: ${json.error.message || 'unknown error'}`,
    );
  }

  return json.result;
}

async function waitForUserOperationReceipt(userOpHash: string) {
  const maxAttempts = 60;
  const delayMs = 2000;

  for (let i = 0; i < maxAttempts; i += 1) {
    try {
      const result = await rpc('eth_getUserOperationReceipt', [userOpHash]);
      if (result) return result;
    } catch {
      // retry
    }
    await sleep(delayMs);
  }

  throw new Error('Timed out waiting for user operation receipt');
}

async function getUSDCBalance(address: string) {
  const balance = await chainPublicClient.readContract({
    address: ERC20_TOKEN,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [getAddress(address)],
  });
  return BigInt(balance as bigint);
}

async function createKernelStack() {
  const kernelAccount = await createKernelAccount(bundlerPublicClient as any, {
    entryPoint: ENTRYPOINT,
    kernelVersion: KERNEL_VERSION,
    eip7702Account: account,
  });

  const kernelClient = createKernelAccountClient({
    account: kernelAccount,
    chain: polygon,
    bundlerTransport: http(BUNDLER_RPC_URL),
    client: bundlerPublicClient as any,
    userOperation: {
      estimateFeesPerGas: async ({ bundlerClient }: any) => {
        return getUserOperationGasPrice(bundlerClient);
      },
    },
  });

  return { kernelAccount, kernelClient };
}

function extractPreparedUserOp(json: PrepareApiResponse) {
  const prepared = json.userOp ?? json.unsignedUserOp?.userOp;
  if (!prepared) {
    throw new Error(
      `Prepare response missing userOp. Keys: ${Object.keys(json || {}).join(', ')}`,
    );
  }
  return prepared;
}

async function callPrepare(
  body: Record<string, any>,
): Promise<PrepareApiResponse> {
  const response = await fetch(`${API_BASE_URL}/sponsorships/prepare`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': API_KEY!,
    },
    body: JSON.stringify(body),
  });

  const rawText = await response.text();
  let json: any = {};
  try {
    json = rawText ? JSON.parse(rawText) : {};
  } catch {
    throw new Error(`Prepare returned non-JSON: ${rawText}`);
  }

  if (!response.ok) {
    throw new Error(`Prepare failed: ${JSON.stringify(json)}`);
  }

  return json as PrepareApiResponse;
}

async function callSubmit(chainId: number, signedUserOp: Record<string, any>) {
  const response = await fetch(`${API_BASE_URL}/sponsorships/submit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': API_KEY!,
    },
    body: JSON.stringify({
      chainId,
      signedUserOp,
    }),
  });

  const rawText = await response.text();
  let json: any = {};
  try {
    json = rawText ? JSON.parse(rawText) : {};
  } catch {
    throw new Error(`Submit returned non-JSON: ${rawText}`);
  }

  if (!response.ok) {
    throw new Error(`Submit failed: ${JSON.stringify(json)}`);
  }

  return json as SubmitApiResponse;
}

function buildSignInput(preparedUserOp: Record<string, any>) {
  return {
    sender: preparedUserOp.sender,
    nonce: toBigIntStrict(preparedUserOp.nonce)!,
    callData: preparedUserOp.callData,

    maxFeePerGas: toBigIntStrict(preparedUserOp.maxFeePerGas),
    maxPriorityFeePerGas: toBigIntStrict(preparedUserOp.maxPriorityFeePerGas),

    callGasLimit: toBigIntStrict(preparedUserOp.callGasLimit),
    verificationGasLimit: toBigIntStrict(preparedUserOp.verificationGasLimit),
    preVerificationGas: toBigIntStrict(preparedUserOp.preVerificationGas),

    paymaster: preparedUserOp.paymaster,
    paymasterVerificationGasLimit: toBigIntStrict(
      preparedUserOp.paymasterVerificationGasLimit,
    ),
    paymasterPostOpGasLimit: toBigIntStrict(
      preparedUserOp.paymasterPostOpGasLimit,
    ),
    paymasterData: preparedUserOp.paymasterData,

    factory: preparedUserOp.factory,
    factoryData: preparedUserOp.factoryData,

    authorization: preparedUserOp.authorization,
  };
}

async function runUnsponsored(runIndex: number): Promise<CompareRow> {
  const { kernelAccount, kernelClient } = await createKernelStack();

  const sender = kernelAccount.address;
  const userCall = buildMinimalUserCall();
  const callData = await (kernelAccount as any).encodeCalls([userCall]);

  const startedAt = Date.now();
  const userOpHash = await (kernelClient as any).sendUserOperation({
    callData,
  });

  const userOpReceipt = await waitForUserOperationReceipt(userOpHash);
  const txHash = userOpReceipt?.receipt?.transactionHash;
  if (!txHash) throw new Error('Unsponsored flow returned no txHash');

  const txReceipt = await chainPublicClient.getTransactionReceipt({
    hash: txHash as Hex,
  });
  const landedAt = Date.now();

  const gasUsed = BigInt(txReceipt.gasUsed);
  const effectiveGasPrice = BigInt(txReceipt.effectiveGasPrice ?? 0n);
  const fee = calcNativeCostWei(gasUsed, effectiveGasPrice);

  return {
    runIndex,
    timestamp: new Date().toISOString(),
    mode: 'unsponsored',
    sender,
    txHash,
    userOpHash,
    prepareLatencyMs: 0,
    submitToLandMs: landedAt - startedAt,
    totalWallClockMs: landedAt - startedAt,
    gasUsed: gasUsed.toString(),
    effectiveGasPriceWei: effectiveGasPrice.toString(),
    actualFeeWei: fee.actualFeeWei.toString(),
    actualFeeNative: fee.actualFeeNative,
    actualFeeUSD: fee.actualFeeUSD,
    userPaysWei: fee.actualFeeWei.toString(),
    userPaysNative: fee.actualFeeNative,
    userPaysUSDC: 0,
    userPaysUSD: fee.actualFeeUSD,
    sponsorPaysWei: '0',
    sponsorPaysNative: 0,
    sponsorPaysUSD: 0,
    success: true,
    error: '',
  };
}

async function runSponsoredViaApi(
  mode: 'verifying' | 'erc20',
  runIndex: number,
): Promise<CompareRow> {
  const { kernelAccount, kernelClient } = await createKernelStack();

  const sender = kernelAccount.address;
  const nonceRaw = await (kernelAccount as any).getNonce();
  const nonceHex =
    typeof nonceRaw === 'bigint'
      ? (`0x${nonceRaw.toString(16)}` as Hex)
      : (nonceRaw as Hex);

  const userCall = buildMinimalUserCall();

  let calls: Array<{ to: string; data: Hex; value?: bigint }> = [userCall];
  let usdcBefore = 0n;

  if (mode === 'erc20') {
    usdcBefore = await getUSDCBalance(sender);

    const approveCall = await getERC20PaymasterApproveCall(
      kernelClient as any,
      {
        gasToken: ERC20_TOKEN,
        approveAmount: parseUnits(
          process.env.ERC20_APPROVE_AMOUNT ?? '1000',
          USDC_DECIMALS,
        ),
        entryPoint: ENTRYPOINT as any,
      },
    );

    calls = [
      {
        to: approveCall.to,
        data: approveCall.data,
        value: BigInt(approveCall.value ?? 0),
      },
      userCall,
    ];
  }

  const encodedCallData = await (kernelAccount as any).encodeCalls(calls);

  const prepareStartedAt = Date.now();
  const preparedJson = await callPrepare({
    chainId: CHAIN_ID,
    from: account.address,
    sender,
    nonce: nonceHex,
    to: userCall.to,
    data: userCall.data,
    value: toHex(userCall.value),
    callData: encodedCallData,
    type: mode,
  });
  const prepareEndedAt = Date.now();

  const preparedUserOp = extractPreparedUserOp(preparedJson);
  const signInput = buildSignInput(preparedUserOp);
  const signResult: any = await (kernelClient as any).signUserOperation(
    signInput as any,
  );

  const rawSignature =
    typeof signResult === 'string' ? signResult : signResult?.signature;

  if (
    !rawSignature ||
    typeof rawSignature !== 'string' ||
    !rawSignature.startsWith('0x')
  ) {
    throw new Error(
      'Failed to extract valid hex signature from signUserOperation result',
    );
  }

  const signedUserOp = {
    ...preparedUserOp,
    signature: rawSignature as Hex,
  };

  const submitStartedAt = Date.now();
  const submitResult = await callSubmit(CHAIN_ID, signedUserOp);

  if (submitResult.error) {
    throw new Error(submitResult.error);
  }
  if (!submitResult.userOpHash) {
    throw new Error(`${mode} submit returned null userOpHash`);
  }

  const userOpReceipt = await waitForUserOperationReceipt(
    submitResult.userOpHash,
  );
  const txHash = userOpReceipt?.receipt?.transactionHash;
  if (!txHash) throw new Error(`${mode} userOp receipt returned no txHash`);

  const txReceipt = await chainPublicClient.waitForTransactionReceipt({
    hash: txHash as Hex,
    pollingInterval: 2000,
    retryCount: 60,
  });
  const landedAt = Date.now();

  const gasUsed = BigInt(txReceipt.gasUsed);
  const effectiveGasPrice = BigInt(txReceipt.effectiveGasPrice ?? 0n);
  const fee = calcNativeCostWei(gasUsed, effectiveGasPrice);

  let userPaysWei = 0n;
  let userPaysNative = 0;
  let userPaysUSDC = 0;
  let userPaysUSD = 0;
  let sponsorPaysWei = fee.actualFeeWei;
  let sponsorPaysNative = fee.actualFeeNative;
  let sponsorPaysUSD = fee.actualFeeUSD;

  if (mode === 'erc20') {
    const usdcAfter = await getUSDCBalance(sender);
    const delta = usdcBefore - usdcAfter;
    userPaysUSDC = Number(delta) / 10 ** USDC_DECIMALS;
    userPaysUSD = userPaysUSDC * USDC_USD;
    sponsorPaysWei = fee.actualFeeWei;
    sponsorPaysNative = fee.actualFeeNative;
    sponsorPaysUSD = fee.actualFeeUSD;
  } else if (mode === 'verifying') {
    // user pays nothing, sponsor pays chain gas
    userPaysWei = 0n;
    userPaysNative = 0;
    userPaysUSDC = 0;
    userPaysUSD = 0;
  }

  return {
    runIndex,
    timestamp: new Date().toISOString(),
    mode,
    sender,
    txHash,
    userOpHash: submitResult.userOpHash,
    prepareLatencyMs: prepareEndedAt - prepareStartedAt,
    submitToLandMs: landedAt - submitStartedAt,
    totalWallClockMs: landedAt - prepareStartedAt,
    gasUsed: gasUsed.toString(),
    effectiveGasPriceWei: effectiveGasPrice.toString(),
    actualFeeWei: fee.actualFeeWei.toString(),
    actualFeeNative: fee.actualFeeNative,
    actualFeeUSD: fee.actualFeeUSD,
    userPaysWei: userPaysWei.toString(),
    userPaysNative,
    userPaysUSDC,
    userPaysUSD,
    sponsorPaysWei: sponsorPaysWei.toString(),
    sponsorPaysNative,
    sponsorPaysUSD,
    success: true,
    error: '',
  };
}

function ensureCsvHeader(filePath: string, headers: string[]) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, `${headers.join(',')}\n`);
  }
}

function appendCsvRow(
  filePath: string,
  values: Array<string | number | boolean>,
) {
  const row = values
    .map((value) => {
      const str = String(value ?? '');
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    })
    .join(',');
  fs.appendFileSync(filePath, `${row}\n`);
}

function median(numbers: number[]) {
  if (numbers.length === 0) return 0;
  const sorted = [...numbers].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return sorted[middle];
}

function average(numbers: number[]) {
  if (numbers.length === 0) return 0;
  return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
}

function writeSummary(rows: CompareRow[]) {
  const headers = [
    'mode',
    'count',
    'successCount',
    'avgPrepareLatencyMs',
    'avgSubmitToLandMs',
    'medianSubmitToLandMs',
    'avgTotalWallClockMs',
    'avgActualFeeUSD',
    'avgUserPaysUSD',
    'avgSponsorPaysUSD',
  ];
  fs.writeFileSync(SUMMARY_CSV, `${headers.join(',')}\n`);

  (['unsponsored', 'verifying', 'erc20'] as SponsorshipMode[]).forEach(
    (mode) => {
      const modeRows = rows.filter((row) => row.mode === mode);
      const successRows = modeRows.filter((row) => row.success);

      appendCsvRow(SUMMARY_CSV, [
        mode,
        modeRows.length,
        successRows.length,
        average(successRows.map((row) => row.prepareLatencyMs)),
        average(successRows.map((row) => row.submitToLandMs)),
        median(successRows.map((row) => row.submitToLandMs)),
        average(successRows.map((row) => row.totalWallClockMs)),
        average(successRows.map((row) => row.actualFeeUSD)),
        average(successRows.map((row) => row.userPaysUSD)),
        average(successRows.map((row) => row.sponsorPaysUSD)),
      ]);
    },
  );
}

async function runSafe(
  mode: SponsorshipMode,
  runIndex: number,
): Promise<CompareRow> {
  try {
    if (mode === 'unsponsored') {
      return await runUnsponsored(runIndex);
    }
    if (mode === 'verifying') {
      return await runSponsoredViaApi('verifying', runIndex);
    }
    return await runSponsoredViaApi('erc20', runIndex);
  } catch (error: any) {
    return {
      runIndex,
      timestamp: new Date().toISOString(),
      mode,
      sender: '',
      txHash: '',
      userOpHash: '',
      prepareLatencyMs: 0,
      submitToLandMs: 0,
      totalWallClockMs: 0,
      gasUsed: '0',
      effectiveGasPriceWei: '0',
      actualFeeWei: '0',
      actualFeeNative: 0,
      actualFeeUSD: 0,
      userPaysWei: '0',
      userPaysNative: 0,
      userPaysUSDC: 0,
      userPaysUSD: 0,
      sponsorPaysWei: '0',
      sponsorPaysNative: 0,
      sponsorPaysUSD: 0,
      success: false,
      error: error?.message ?? String(error),
    };
  }
}

async function main() {
  ensureCsvHeader(RESULTS_CSV, [
    'runIndex',
    'timestamp',
    'mode',
    'sender',
    'txHash',
    'userOpHash',
    'prepareLatencyMs',
    'submitToLandMs',
    'totalWallClockMs',
    'gasUsed',
    'effectiveGasPriceWei',
    'actualFeeWei',
    'actualFeeNative',
    'actualFeeUSD',
    'userPaysWei',
    'userPaysNative',
    'userPaysUSDC',
    'userPaysUSD',
    'sponsorPaysWei',
    'sponsorPaysNative',
    'sponsorPaysUSD',
    'success',
    'error',
  ]);

  const allRows: CompareRow[] = [];
  console.log(
    '\n=== START COMPARE: UNSPONSORED vs VERIFYING vs ERC20 ON POLYGON ===\n',
  );
  console.log(`Account EOA: ${account.address}`);
  console.log(`API_BASE_URL: ${API_BASE_URL}`);
  console.log(`BUNDLER_RPC_URL: ${BUNDLER_RPC_URL}`);
  console.log(`ERC20_GAS_TOKEN: ${ERC20_TOKEN}`);
  console.log(`MINIMAL_CALL_TO: ${MINIMAL_CALL_TO}`);
  console.log(`RUN_COUNT: ${RUN_COUNT}`);
  console.log(`DELAY_MS: ${DELAY_MS}`);

  for (let runIndex = 1; runIndex <= RUN_COUNT; runIndex += 1) {
    console.log(`\n===== RUN ${runIndex}/${RUN_COUNT} =====`);

    for (const mode of [
      'unsponsored',
      'verifying',
      'erc20',
    ] as SponsorshipMode[]) {
      console.log(`\n--- ${mode.toUpperCase()} ---`);
      const row = await runSafe(mode, runIndex);
      allRows.push(row);

      appendCsvRow(RESULTS_CSV, [
        row.runIndex,
        row.timestamp,
        row.mode,
        row.sender,
        row.txHash,
        row.userOpHash,
        row.prepareLatencyMs,
        row.submitToLandMs,
        row.totalWallClockMs,
        row.gasUsed,
        row.effectiveGasPriceWei,
        row.actualFeeWei,
        row.actualFeeNative,
        row.actualFeeUSD,
        row.userPaysWei,
        row.userPaysNative,
        row.userPaysUSDC,
        row.userPaysUSD,
        row.sponsorPaysWei,
        row.sponsorPaysNative,
        row.sponsorPaysUSD,
        row.success,
        row.error,
      ]);

      console.log(row);
      if (mode !== 'erc20') {
        await sleep(3000);
      }
    }

    if (runIndex < RUN_COUNT) {
      console.log(`\nWaiting ${DELAY_MS} ms before next run...`);
      await sleep(DELAY_MS);
    }
  }

  writeSummary(allRows);
  console.log('\n=== DONE ===');
  console.log(`Results CSV: ${RESULTS_CSV}`);
  console.log(`Summary CSV: ${SUMMARY_CSV}`);
}

main().catch((error) => {
  console.error('\n[script error]');
  console.error(error);
  process.exit(1);
});
