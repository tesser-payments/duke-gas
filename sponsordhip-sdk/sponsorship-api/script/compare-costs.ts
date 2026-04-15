import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

import { privateKeyToAccount } from 'viem/accounts';
import {
  createPublicClient,
  createWalletClient,
  http,
  type Hex,
  encodeFunctionData,
  erc20Abi,
  getAddress,
} from 'viem';
import { polygon } from 'viem/chains';

import {
  createKernelAccount,
  createKernelAccountClient,
  createZeroDevPaymasterClient,
  constants,
  gasTokenAddresses,
  getERC20PaymasterApproveCall,
} from '@zerodev/sdk';
import { getUserOperationGasPrice } from '@zerodev/sdk/actions';

dotenv.config({
  path: path.resolve(process.cwd(), '.env'),
});

type PrepareResponse = {
  message: string;
  input: {
    from: string;
    to?: string;
    data?: `0x${string}`;
    value?: string;
    nonce?: number;
    gasLimit?: string;
    gasPrice?: string;
    type?: 'verifying' | 'erc20';
  };
  unsignedUserOp: {
    stage: string;
    sponsorEnabled: boolean;
    sponsorType?: string;
    requestedFrom: string;
    actualSignerAddress: string;
    kernelAccountAddress: string;
    call: {
      to: string | null;
      data: `0x${string}`;
      value: string;
    };
    userOp: Record<string, any>;
    note?: string;
  };
};

type SubmitResponse = {
  userOpHash: string | null;
  txHash: string | null;
  error?: string;
};

type CompareRow = {
  mode: 'unsponsored' | 'verifying' | 'erc20';
  txHash: string;
  gasUsed: string;
  effectiveGasPriceWei: string;
  nativeCostWei: string;
  nativeCostToken: number;
  costUSD: number;
  latencyMs: number;
};

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:3000';
const API_KEY = process.env.X_API_KEY ?? 'my-secret-key';
const RPC_URL = process.env.RPC_URL as string | undefined;
const TEST_PRIVATE_KEY = process.env.TEST_PRIVATE_KEY as Hex | undefined;
const ZERODEV_RPC = process.env.ZERODEV_RPC;

if (!ZERODEV_RPC) {
  throw new Error('Missing ZERODEV_RPC in .env');
}

const ZERODEV_RPC_URL: string = ZERODEV_RPC;

// 你要硬編碼的價格就改這裡
// Polygon 上這裡代表 native gas token 的 USD 價格（POL / MATIC）
const NATIVE_TOKEN_USD_PRICE = 0.7;

// 真正 transfer 的 ERC20（Polygon USDC）
const ERC20_TOKEN = getAddress('0x3c499c542cef5e3811e1192ce70d8cc03d5c3359');
const RECIPIENT = getAddress('0x2222222222222222222222222222222222222222');
const AMOUNT = 1n;

const RESULTS_CSV = path.resolve(process.cwd(), 'results.csv');

if (!RPC_URL) {
  throw new Error('Missing RPC_URL in .env');
}
if (!TEST_PRIVATE_KEY) {
  throw new Error('Missing TEST_PRIVATE_KEY in .env');
}
if (!ZERODEV_RPC) {
  throw new Error('Missing ZERODEV_RPC in .env');
}

const account = privateKeyToAccount(TEST_PRIVATE_KEY);

const publicClient: any = createPublicClient({
  chain: polygon,
  transport: http(RPC_URL),
});

function buildTransferData() {
  return encodeFunctionData({
    abi: erc20Abi,
    functionName: 'transfer',
    args: [RECIPIENT, AMOUNT],
  });
}

function calcNativeCost(gasUsed: bigint, effectiveGasPrice: bigint) {
  const nativeCostWei = gasUsed * effectiveGasPrice;
  const nativeCostToken = Number(nativeCostWei) / 1e18;
  const costUSD = nativeCostToken * NATIVE_TOKEN_USD_PRICE;

  return {
    nativeCostWei: nativeCostWei.toString(),
    nativeCostToken,
    costUSD,
  };
}

function parseReceipt(receipt: any) {
  const gasUsed = BigInt(receipt.gasUsed);
  const effectiveGasPrice = BigInt(receipt.effectiveGasPrice);

  const { nativeCostWei, nativeCostToken, costUSD } = calcNativeCost(
    gasUsed,
    effectiveGasPrice,
  );

  return {
    gasUsed: gasUsed.toString(),
    effectiveGasPriceWei: effectiveGasPrice.toString(),
    nativeCostWei,
    nativeCostToken,
    costUSD,
  };
}

async function rpc(method: string, params: any[]) {
  const response = await fetch(ZERODEV_RPC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
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
  const maxAttempts = 40;
  const delayMs = 2000;

  for (let i = 0; i < maxAttempts; i += 1) {
    try {
      const result = await rpc('eth_getUserOperationReceipt', [userOpHash]);
      if (result) return result;
    } catch {
      // ignore and retry
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  throw new Error('Timed out waiting for user operation receipt');
}

async function createSigningKernelClient() {
  const entryPoint = constants.getEntryPoint('0.7');

  const kernelAccount = await createKernelAccount(publicClient as any, {
    entryPoint,
    kernelVersion: constants.KERNEL_V3_3,
    eip7702Account: account,
  });

  const paymasterClient = createZeroDevPaymasterClient({
    chain: polygon,
    transport: http(ZERODEV_RPC),
  });

  const kernelClient = createKernelAccountClient({
    account: kernelAccount,
    chain: polygon,
    bundlerTransport: http(ZERODEV_RPC),
    client: publicClient as any,
    userOperation: {
      estimateFeesPerGas: async ({ bundlerClient }: any) => {
        return getUserOperationGasPrice(bundlerClient);
      },
    },
    paymaster: {
      getPaymasterData: async (userOperation: any) => {
        return paymasterClient.sponsorUserOperation({ userOperation });
      },
    },
  });

  return { kernelClient };
}

async function createErc20KernelClient() {
  const entryPoint = constants.getEntryPoint('0.7');

  const kernelAccount = await createKernelAccount(publicClient as any, {
    entryPoint,
    kernelVersion: constants.KERNEL_V3_3,
    eip7702Account: account,
  });

  const paymasterClient = createZeroDevPaymasterClient({
    chain: polygon,
    transport: http(ZERODEV_RPC),
  });

  const kernelClient = createKernelAccountClient({
    account: kernelAccount,
    chain: polygon,
    bundlerTransport: http(ZERODEV_RPC),
    client: publicClient as any,
    userOperation: {
      estimateFeesPerGas: async ({ bundlerClient }: any) => {
        return getUserOperationGasPrice(bundlerClient);
      },
    },
    paymaster: paymasterClient,
    paymasterContext: {
      token: gasTokenAddresses[polygon.id]['USDC'],
    },
  });

  return { kernelClient, paymasterClient, entryPoint };
}

async function callPrepareVerifying(): Promise<PrepareResponse> {
  const data = buildTransferData();

  const response = await fetch(`${API_BASE_URL}/sponsorships/prepare`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': API_KEY,
    },
    body: JSON.stringify({
      from: account.address,
      to: ERC20_TOKEN,
      data,
      value: '0',
      type: 'verifying',
    }),
  });

  const json: any = await response.json();

  if (!response.ok) {
    throw new Error(`Prepare failed: ${JSON.stringify(json)}`);
  }

  return json as PrepareResponse;
}

async function signUserOperation(userOp: Record<string, any>) {
  const { kernelClient } = await createSigningKernelClient();

  const signedUserOp = { ...userOp };

  const realSignature = await (kernelClient.account as any).signUserOperation({
    sender: signedUserOp.sender,
    nonce: signedUserOp.nonce,
    callData: signedUserOp.callData,

    callGasLimit: signedUserOp.callGasLimit,
    verificationGasLimit: signedUserOp.verificationGasLimit,
    preVerificationGas: signedUserOp.preVerificationGas,

    maxFeePerGas: signedUserOp.maxFeePerGas,
    maxPriorityFeePerGas: signedUserOp.maxPriorityFeePerGas,

    paymaster: signedUserOp.paymaster,
    paymasterVerificationGasLimit: signedUserOp.paymasterVerificationGasLimit,
    paymasterPostOpGasLimit: signedUserOp.paymasterPostOpGasLimit,
    paymasterData: signedUserOp.paymasterData,

    factory: signedUserOp.factory,
    factoryData: signedUserOp.factoryData,
    signature: '0x',
  });

  signedUserOp.signature = realSignature;
  return signedUserOp;
}

async function sdkSubmitUserOp(
  signedUserOp: Record<string, any>,
): Promise<SubmitResponse> {
  const { kernelClient } = await createSigningKernelClient();

  const userOpHash = await (kernelClient as any).sendUserOperation({
    sender: signedUserOp.sender,
    nonce: signedUserOp.nonce,
    callData: signedUserOp.callData,
    signature: signedUserOp.signature,

    callGasLimit: signedUserOp.callGasLimit,
    verificationGasLimit: signedUserOp.verificationGasLimit,
    preVerificationGas: signedUserOp.preVerificationGas,

    maxFeePerGas: signedUserOp.maxFeePerGas,
    maxPriorityFeePerGas: signedUserOp.maxPriorityFeePerGas,

    paymaster: signedUserOp.paymaster,
    paymasterVerificationGasLimit: signedUserOp.paymasterVerificationGasLimit,
    paymasterPostOpGasLimit: signedUserOp.paymasterPostOpGasLimit,
    paymasterData: signedUserOp.paymasterData,

    factory: signedUserOp.factory,
    factoryData: signedUserOp.factoryData,

    authorization: signedUserOp.authorization,
  });

  const receipt = await waitForUserOperationReceipt(userOpHash);
  const txHash = receipt?.receipt?.transactionHash ?? null;

  return {
    userOpHash,
    txHash,
  };
}

async function approveErc20ForPaymaster() {
  const { kernelClient, paymasterClient, entryPoint } =
    await createErc20KernelClient();

  const approveCall = await getERC20PaymasterApproveCall(paymasterClient, {
    gasToken: gasTokenAddresses[polygon.id]['USDC'],
    approveAmount: 1_000_000n,
    entryPoint,
  });

  const userOpHash = await (kernelClient as any).sendUserOperation({
    callData: await (kernelClient.account as any).encodeCalls([approveCall]),
  });

  const receipt = await waitForUserOperationReceipt(userOpHash);
  const txHash = receipt?.receipt?.transactionHash ?? null;

  return {
    userOpHash,
    txHash,
  };
}

async function runUnsponsored(): Promise<CompareRow> {
  console.log('\n=== UNSPONSORED ===\n');

  const walletClient: any = createWalletClient({
    account,
    chain: polygon,
    transport: http(RPC_URL),
  });

  const start = Date.now();

  const hash = await walletClient.sendTransaction({
    to: ERC20_TOKEN,
    data: buildTransferData(),
  });

  const receipt = await publicClient.waitForTransactionReceipt({
    hash,
    pollingInterval: 2_000,
    retryCount: 60,
  });
  const latencyMs = Date.now() - start;
  const parsed = parseReceipt(receipt);

  return {
    mode: 'unsponsored',
    txHash: hash,
    latencyMs,
    ...parsed,
  };
}

async function logNativeBalance() {
  const balance = await publicClient.getBalance({ address: account.address });
  console.log('\n[native balance]');
  console.log('wei:', balance.toString());
  console.log('token:', Number(balance) / 1e18);
}
async function runVerifying(): Promise<CompareRow> {
  console.log('\n=== VERIFYING SPONSOR ===\n');

  const { kernelClient } = await createSigningKernelClient();
  const start = Date.now();

  const transferCall = {
    to: ERC20_TOKEN,
    data: buildTransferData(),
    value: 0n,
  };

  const userOpHash = await (kernelClient as any).sendUserOperation({
    callData: await (kernelClient.account as any).encodeCalls([transferCall]),
  });

  const receiptOp = await waitForUserOperationReceipt(userOpHash);
  const txHash = receiptOp?.receipt?.transactionHash;

  if (!txHash) {
    throw new Error('Verifying txHash is null');
  }

  const receipt = await publicClient.getTransactionReceipt({
    hash: txHash,
  });

  const latencyMs = Date.now() - start;
  const parsed = parseReceipt(receipt);

  return {
    mode: 'verifying',
    txHash,
    latencyMs,
    ...parsed,
  };
}

async function runErc20(): Promise<CompareRow> {
  console.log('\n=== ERC20 SPONSOR ===\n');

  const { kernelClient } = await createErc20KernelClient();
  const start = Date.now();

  const transferCall = {
    to: ERC20_TOKEN,
    data: buildTransferData(),
    value: 0n,
  };

  const userOpHash = await (kernelClient as any).sendUserOperation({
    callData: await (kernelClient.account as any).encodeCalls([transferCall]),
  });

  const receiptOp = await waitForUserOperationReceipt(userOpHash);
  const txHash = receiptOp?.receipt?.transactionHash;

  if (!txHash) {
    throw new Error('ERC20 sponsor txHash is null');
  }

  const receipt = await publicClient.getTransactionReceipt({
    hash: txHash,
  });

  const latencyMs = Date.now() - start;
  const parsed = parseReceipt(receipt);

  return {
    mode: 'erc20',
    txHash,
    latencyMs,
    ...parsed,
  };
}

function ensureCSVHeader() {
  const headers = [
    'runIndex',
    'timestamp',
    'mode',
    'txHash',
    'gasUsed',
    'effectiveGasPriceWei',
    'nativeCostWei',
    'nativeCostToken',
    'costUSD',
    'latencyMs',
  ];

  if (!fs.existsSync(RESULTS_CSV)) {
    fs.writeFileSync(RESULTS_CSV, `${headers.join(',')}\n`);
  }
}

function appendCSV(runIndex: number, results: CompareRow[]) {
  const timestamp = new Date().toISOString();

  const rows = results.map((row) =>
    [
      runIndex,
      timestamp,
      row.mode,
      row.txHash,
      row.gasUsed,
      row.effectiveGasPriceWei,
      row.nativeCostWei,
      row.nativeCostToken,
      row.costUSD,
      row.latencyMs,
    ].join(','),
  );

  fs.appendFileSync(RESULTS_CSV, `${rows.join('\n')}\n`);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureErc20Approval() {
  console.log('\n=== ENSURE ERC20 APPROVAL ===\n');
  const result = await approveErc20ForPaymaster();
  console.log('[approve] userOpHash:', result.userOpHash);
  console.log('[approve] txHash:', result.txHash);
}

async function main() {
  const INTERVAL_MS = 30 * 60 * 1000; // 30 min
  const TOTAL_RUNS = 24; // 12 小時

  // 初始化 CSV（只在第一次寫 header）
  if (!fs.existsSync(RESULTS_CSV)) {
    fs.writeFileSync(
      RESULTS_CSV,
      'runIndex,timestamp,mode,txHash,gasUsed,effectiveGasPriceWei,nativeCostWei,nativeCostToken,costUSD,latencyMs\n',
    );
  }

  console.log('\n=== START AUTO RUN ===\n');

  await logNativeBalance();
  await ensureErc20Approval();

  for (let i = 1; i <= TOTAL_RUNS; i++) {
    console.log(`\n===== RUN ${i}/${TOTAL_RUNS} =====\n`);

    const results: CompareRow[] = [];

    try {
      results.push(await runUnsponsored());
    } catch (e) {
      console.error('unsponsored failed', e);
    }

    try {
      results.push(await runVerifying());
    } catch (e) {
      console.error('verifying failed', e);
    }

    try {
      results.push(await runErc20());
    } catch (e) {
      console.error('erc20 failed', e);
    }

    const timestamp = new Date().toISOString();

    const rows = results.map((r) =>
      [
        i,
        timestamp,
        r.mode,
        r.txHash,
        r.gasUsed,
        r.effectiveGasPriceWei,
        r.nativeCostWei,
        r.nativeCostToken,
        r.costUSD,
        r.latencyMs,
      ].join(','),
    );

    fs.appendFileSync(RESULTS_CSV, rows.join('\n') + '\n');

    console.log(`Run ${i} saved`);

    if (i < TOTAL_RUNS) {
      console.log('Waiting 30 minutes...\n');
      await new Promise((res) => setTimeout(res, INTERVAL_MS));
    }
  }

  console.log('\n=== ALL DONE ===\n');
}

main().catch((error) => {
  console.error('\n[script error]');
  console.error(error);
  process.exit(1);
});
