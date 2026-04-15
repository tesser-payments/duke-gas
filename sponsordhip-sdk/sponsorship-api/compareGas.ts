import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

import {
  createPublicClient,
  createWalletClient,
  formatEther,
  http,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';

import {
  createKernelAccount,
  createKernelAccountClient,
  createZeroDevPaymasterClient,
  constants,
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
  };
  unsignedUserOp: {
    stage: string;
    sponsorEnabled: boolean;
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
  message?: string;
  signedUserOp?: Record<string, any>;
  userOpHash: string | null;
  txHash: string | null;
  error?: string;
};

type UnsponsoredResult = {
  txHash: string;
  gasUsed: bigint;
  effectiveGasPrice: bigint;
  actualFeeWei: bigint;
  latencyMs: number;
};

type SponsoredReceiptResult = {
  txHash: string;
  gasUsed: bigint;
  effectiveGasPrice: bigint;
  actualFeeWei: bigint;
};

type SponsoredResult = {
  userOpHash: string | null;
  txHash: string | null;
  sponsoredReceipt: SponsoredReceiptResult | null;
  latencyMs: number;
  gasBreakdown: {
    callGasLimit: string;
    verificationGasLimit: string;
    preVerificationGas: string;
    paymasterVerificationGasLimit: string;
    paymasterPostOpGasLimit: string;
  };
  raw: SubmitResponse;
};

const rpcUrl = process.env.RPC_URL as string | undefined;
const privateKey = process.env.PRIVATE_KEY as Hex | undefined;
const toAddress = process.env.TO_ADDRESS as `0x${string}` | undefined;

const sponsorApiBaseUrl =
  process.env.SPONSOR_API_BASE_URL ?? 'http://localhost:3000';
const sponsorApiKey = process.env.SPONSOR_API_KEY ?? 'my-secret-key';
const zeroDevRpc = process.env.ZERODEV_RPC as string | undefined;

const runCount = Number(process.env.RUN_COUNT ?? '1');
const delayMs = Number(process.env.DELAY_MS ?? '3000');
const csvFile = process.env.CSV_FILE ?? 'gas-results.csv';

if (!rpcUrl) {
  throw new Error('Missing RPC_URL in .env');
}

if (!privateKey) {
  throw new Error('Missing PRIVATE_KEY in .env');
}

if (!toAddress) {
  throw new Error('Missing TO_ADDRESS in .env');
}

if (!zeroDevRpc) {
  throw new Error('Missing ZERODEV_RPC in .env');
}

const account = privateKeyToAccount(privateKey);

const publicClient: any = createPublicClient({
  chain: sepolia,
  transport: http(rpcUrl),
});

const walletClient: any = createWalletClient({
  account,
  chain: sepolia,
  transport: http(rpcUrl),
});

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureCsvHeader() {
  if (fs.existsSync(csvFile)) {
    return;
  }

  const header = [
    'timestamp',
    'runIndex',

    'unsponsoredTxHash',
    'unsponsoredGasUsed',
    'unsponsoredEffectiveGasPriceWei',
    'unsponsoredActualFeeWei',
    'unsponsoredActualFeeETH',
    'unsponsoredLatencyMs',

    'sponsoredUserOpHash',
    'sponsoredTxHash',
    'sponsoredGasUsed',
    'sponsoredEffectiveGasPriceWei',
    'sponsoredActualFeeWei',
    'sponsoredActualFeeETH',
    'sponsoredLatencyMs',

    'sponsoredCallGasLimit',
    'sponsoredVerificationGasLimit',
    'sponsoredPreVerificationGas',
    'sponsoredPaymasterVerificationGasLimit',
    'sponsoredPaymasterPostOpGasLimit',

    'unsponsoredUserPaysWei',
    'unsponsoredUserPaysETH',
    'sponsoredUserPaysWei',
    'sponsoredUserPaysETH',
  ].join(',');

  fs.writeFileSync(csvFile, header + '\n', 'utf8');
}

function appendCsvRow(row: Record<string, string | number>) {
  const values = [
    row.timestamp,
    row.runIndex,

    row.unsponsoredTxHash,
    row.unsponsoredGasUsed,
    row.unsponsoredEffectiveGasPriceWei,
    row.unsponsoredActualFeeWei,
    row.unsponsoredActualFeeETH,
    row.unsponsoredLatencyMs,

    row.sponsoredUserOpHash,
    row.sponsoredTxHash,
    row.sponsoredGasUsed,
    row.sponsoredEffectiveGasPriceWei,
    row.sponsoredActualFeeWei,
    row.sponsoredActualFeeETH,
    row.sponsoredLatencyMs,

    row.sponsoredCallGasLimit,
    row.sponsoredVerificationGasLimit,
    row.sponsoredPreVerificationGas,
    row.sponsoredPaymasterVerificationGasLimit,
    row.sponsoredPaymasterPostOpGasLimit,

    row.unsponsoredUserPaysWei,
    row.unsponsoredUserPaysETH,
    row.sponsoredUserPaysWei,
    row.sponsoredUserPaysETH,
  ]
    .map((v) => String(v).replaceAll(',', ';'))
    .join(',');

  fs.appendFileSync(csvFile, values + '\n', 'utf8');
}

function printDivider(title: string) {
  console.log(`\n=== ${title} ===`);
}

async function sendUnsponsoredTx(): Promise<UnsponsoredResult> {
  printDivider('Sending unsponsored EIP-1559 transaction');

  const start = Date.now();

  const hash = await walletClient.sendTransaction({
    account,
    to: toAddress,
    value: 0n,
    chain: sepolia,
  });

  console.log('Unsponsored tx hash:', hash);

  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  const latencyMs = Date.now() - start;
  const gasUsed = BigInt(receipt.gasUsed);
  const effectiveGasPrice = BigInt(receipt.effectiveGasPrice ?? 0n);
  const actualFeeWei = gasUsed * effectiveGasPrice;

  console.log('gasUsed:', gasUsed.toString());
  console.log('effectiveGasPrice:', effectiveGasPrice.toString());
  console.log('actualFeeWei:', actualFeeWei.toString());
  console.log('actualFeeETH:', formatEther(actualFeeWei));
  console.log('latencyMs:', latencyMs);

  return {
    txHash: hash,
    gasUsed,
    effectiveGasPrice,
    actualFeeWei,
    latencyMs,
  };
}

async function createSigningKernelClient() {
  const entryPoint = constants.getEntryPoint('0.7');

  const kernelAccount = await createKernelAccount(publicClient, {
    entryPoint,
    kernelVersion: constants.KERNEL_V3_3,
    eip7702Account: account,
  });

  const paymasterClient = createZeroDevPaymasterClient({
    chain: sepolia,
    transport: http(zeroDevRpc),
  });

  const kernelClient = createKernelAccountClient({
    account: kernelAccount,
    chain: sepolia,
    bundlerTransport: http(zeroDevRpc),
    client: publicClient,
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

async function prepareSponsoredUserOp(): Promise<Record<string, any>> {
  printDivider('Calling /sponsorships/prepare');

  const res = await fetch(`${sponsorApiBaseUrl}/sponsorships/prepare`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': sponsorApiKey,
    },
    body: JSON.stringify({
      from: account.address,
      to: toAddress,
      data: '0x',
      value: '0',
    }),
  });

  const json = (await res.json()) as PrepareResponse;

  if (!res.ok) {
    throw new Error(`Prepare failed: ${JSON.stringify(json)}`);
  }

  console.log('prepare response:', JSON.stringify(json, null, 2));

  const unsignedUserOp = json?.unsignedUserOp?.userOp;

  if (!unsignedUserOp) {
    throw new Error('prepare response missing unsignedUserOp.userOp');
  }

  return unsignedUserOp;
}

async function signPreparedUserOp(unsignedUserOp: Record<string, any>) {
  const { kernelClient } = await createSigningKernelClient();

  const signedUserOp = {
    ...unsignedUserOp,
  };

  printDivider('Signing sponsored UserOperation');
  console.log('[debug] sender:', signedUserOp.sender);
  console.log('[debug] nonce:', signedUserOp.nonce);

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

  printDivider('Signed UserOperation');
  console.log(JSON.stringify(signedUserOp, null, 2));

  return signedUserOp;
}

async function submitSponsoredUserOp(
  signedUserOp: Record<string, any>,
): Promise<SubmitResponse> {
  printDivider('Calling /sponsorships/submit');

  const res = await fetch(`${sponsorApiBaseUrl}/sponsorships/submit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': sponsorApiKey,
    },
    body: JSON.stringify({
      signedUserOp,
    }),
  });

  const json = (await res.json()) as SubmitResponse;

  if (!res.ok) {
    throw new Error(`Submit failed: ${JSON.stringify(json)}`);
  }

  console.log('submit response:', JSON.stringify(json, null, 2));

  return json;
}

async function tryGetSponsoredReceipt(txHash: string | null) {
  if (!txHash) {
    console.log('\n[info] /submit did not return txHash yet.');
    console.log(
      '[info] That usually means the backend only returned userOpHash, not final on-chain tx hash.',
    );
    return null;
  }

  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash as `0x${string}`,
  });

  const gasUsed = BigInt(receipt.gasUsed);
  const effectiveGasPrice = BigInt(receipt.effectiveGasPrice ?? 0n);
  const actualFeeWei = gasUsed * effectiveGasPrice;

  return {
    txHash,
    gasUsed,
    effectiveGasPrice,
    actualFeeWei,
  };
}

async function sendSponsoredTx(): Promise<SponsoredResult> {
  const start = Date.now();

  const unsignedUserOp = await prepareSponsoredUserOp();

  const gasBreakdown = {
    callGasLimit: String(unsignedUserOp.callGasLimit ?? ''),
    verificationGasLimit: String(unsignedUserOp.verificationGasLimit ?? ''),
    preVerificationGas: String(unsignedUserOp.preVerificationGas ?? ''),
    paymasterVerificationGasLimit: String(
      unsignedUserOp.paymasterVerificationGasLimit ?? '',
    ),
    paymasterPostOpGasLimit: String(
      unsignedUserOp.paymasterPostOpGasLimit ?? '',
    ),
  };

  const signedUserOp = await signPreparedUserOp(unsignedUserOp);
  const submitResult = await submitSponsoredUserOp(signedUserOp);

  if (submitResult.error) {
    throw new Error(`Sponsored submit failed: ${submitResult.error}`);
  }

  const sponsoredReceipt = await tryGetSponsoredReceipt(submitResult.txHash);
  const latencyMs = Date.now() - start;

  return {
    userOpHash: submitResult.userOpHash,
    txHash: submitResult.txHash,
    sponsoredReceipt,
    latencyMs,
    gasBreakdown,
    raw: submitResult,
  };
}

function printRunSummary(
  runIndex: number,
  unsponsored: UnsponsoredResult,
  sponsored: SponsoredResult,
) {
  printDivider(`Run ${runIndex} Summary`);

  console.log({
    unsponsoredTxHash: unsponsored.txHash,
    unsponsoredGasUsed: unsponsored.gasUsed.toString(),
    unsponsoredEffectiveGasPrice: unsponsored.effectiveGasPrice.toString(),
    unsponsoredActualFeeWei: unsponsored.actualFeeWei.toString(),
    unsponsoredActualFeeETH: formatEther(unsponsored.actualFeeWei),
    unsponsoredLatencyMs: unsponsored.latencyMs,

    sponsoredUserOpHash: sponsored.userOpHash,
    sponsoredTxHash: sponsored.txHash,
    sponsoredLatencyMs: sponsored.latencyMs,

    sponsoredGasUsed: sponsored.sponsoredReceipt
      ? sponsored.sponsoredReceipt.gasUsed.toString()
      : 'N/A',
    sponsoredEffectiveGasPrice: sponsored.sponsoredReceipt
      ? sponsored.sponsoredReceipt.effectiveGasPrice.toString()
      : 'N/A',
    sponsoredActualFeeWei: sponsored.sponsoredReceipt
      ? sponsored.sponsoredReceipt.actualFeeWei.toString()
      : 'N/A',
    sponsoredActualFeeETH: sponsored.sponsoredReceipt
      ? formatEther(sponsored.sponsoredReceipt.actualFeeWei)
      : 'N/A',

    sponsoredCallGasLimit: sponsored.gasBreakdown.callGasLimit,
    sponsoredVerificationGasLimit: sponsored.gasBreakdown.verificationGasLimit,
    sponsoredPreVerificationGas: sponsored.gasBreakdown.preVerificationGas,
    sponsoredPaymasterVerificationGasLimit:
      sponsored.gasBreakdown.paymasterVerificationGasLimit,
    sponsoredPaymasterPostOpGasLimit:
      sponsored.gasBreakdown.paymasterPostOpGasLimit,

    unsponsoredUserPaysWei: unsponsored.actualFeeWei.toString(),
    unsponsoredUserPaysETH: formatEther(unsponsored.actualFeeWei),

    sponsoredUserPaysWei: '0',
    sponsoredUserPaysETH: '0',
  });
}

function printFinalAggregate(
  rows: Array<{
    unsponsoredFeeWei: bigint;
    sponsoredFeeWei: bigint;
    unsponsoredLatencyMs: number;
    sponsoredLatencyMs: number;
    sponsoredHasReceipt: boolean;
  }>,
) {
  const count = rows.length;

  if (count === 0) {
    return;
  }

  let unsponsoredFeeTotal = 0n;
  let sponsoredFeeTotal = 0n;
  let unsponsoredLatencyTotal = 0;
  let sponsoredLatencyTotal = 0;
  let sponsoredReceiptCount = 0;

  for (const row of rows) {
    unsponsoredFeeTotal += row.unsponsoredFeeWei;
    unsponsoredLatencyTotal += row.unsponsoredLatencyMs;
    sponsoredLatencyTotal += row.sponsoredLatencyMs;

    if (row.sponsoredHasReceipt) {
      sponsoredFeeTotal += row.sponsoredFeeWei;
      sponsoredReceiptCount += 1;
    }
  }

  printDivider('Final Aggregate Summary');

  console.log({
    runs: count,
    sponsoredRunsWithReceipt: sponsoredReceiptCount,

    avgUnsponsoredFeeWei: (unsponsoredFeeTotal / BigInt(count)).toString(),
    avgUnsponsoredFeeETH: formatEther(unsponsoredFeeTotal / BigInt(count)),

    avgSponsoredFeeWei:
      sponsoredReceiptCount > 0
        ? (sponsoredFeeTotal / BigInt(sponsoredReceiptCount)).toString()
        : 'N/A',
    avgSponsoredFeeETH:
      sponsoredReceiptCount > 0
        ? formatEther(sponsoredFeeTotal / BigInt(sponsoredReceiptCount))
        : 'N/A',

    avgUnsponsoredLatencyMs: Math.round(unsponsoredLatencyTotal / count),
    avgSponsoredLatencyMs: Math.round(sponsoredLatencyTotal / count),
  });
}

async function runOnce(runIndex: number) {
  const unsponsored = await sendUnsponsoredTx();

  printDivider('Unsponsored Result');
  console.log({
    txHash: unsponsored.txHash,
    gasUsed: unsponsored.gasUsed.toString(),
    effectiveGasPrice: unsponsored.effectiveGasPrice.toString(),
    actualFeeWei: unsponsored.actualFeeWei.toString(),
    actualFeeETH: formatEther(unsponsored.actualFeeWei),
    latencyMs: unsponsored.latencyMs,
  });

  const sponsored = await sendSponsoredTx();

  printDivider('Sponsored Result');
  console.log({
    userOpHash: sponsored.userOpHash,
    txHash: sponsored.txHash,
    latencyMs: sponsored.latencyMs,
  });

  if (sponsored.sponsoredReceipt) {
    printDivider('Sponsored On-chain Cost');
    console.log({
      txHash: sponsored.sponsoredReceipt.txHash,
      gasUsed: sponsored.sponsoredReceipt.gasUsed.toString(),
      effectiveGasPrice:
        sponsored.sponsoredReceipt.effectiveGasPrice.toString(),
      actualFeeWei: sponsored.sponsoredReceipt.actualFeeWei.toString(),
      actualFeeETH: formatEther(sponsored.sponsoredReceipt.actualFeeWei),
    });
  } else {
    printDivider('Sponsored On-chain Cost');
    console.log({
      note: 'Sponsored txHash not returned yet, so sponsored on-chain cost is unavailable in this run.',
    });
  }

  printDivider('Sponsored Gas Breakdown');
  console.log(sponsored.gasBreakdown);

  printDivider('Comparison');
  console.log({
    unsponsoredNetworkCostWei: unsponsored.actualFeeWei.toString(),
    unsponsoredNetworkCostETH: formatEther(unsponsored.actualFeeWei),

    sponsoredNetworkCostWei: sponsored.sponsoredReceipt
      ? sponsored.sponsoredReceipt.actualFeeWei.toString()
      : 'N/A',
    sponsoredNetworkCostETH: sponsored.sponsoredReceipt
      ? formatEther(sponsored.sponsoredReceipt.actualFeeWei)
      : 'N/A',

    unsponsoredUserPaysWei: unsponsored.actualFeeWei.toString(),
    unsponsoredUserPaysETH: formatEther(unsponsored.actualFeeWei),

    sponsoredUserPaysWei: '0',
    sponsoredUserPaysETH: '0',
  });

  appendCsvRow({
    timestamp: new Date().toISOString(),
    runIndex,

    unsponsoredTxHash: unsponsored.txHash,
    unsponsoredGasUsed: unsponsored.gasUsed.toString(),
    unsponsoredEffectiveGasPriceWei: unsponsored.effectiveGasPrice.toString(),
    unsponsoredActualFeeWei: unsponsored.actualFeeWei.toString(),
    unsponsoredActualFeeETH: formatEther(unsponsored.actualFeeWei),
    unsponsoredLatencyMs: unsponsored.latencyMs,

    sponsoredUserOpHash: sponsored.userOpHash ?? '',
    sponsoredTxHash: sponsored.txHash ?? '',
    sponsoredGasUsed: sponsored.sponsoredReceipt
      ? sponsored.sponsoredReceipt.gasUsed.toString()
      : '',
    sponsoredEffectiveGasPriceWei: sponsored.sponsoredReceipt
      ? sponsored.sponsoredReceipt.effectiveGasPrice.toString()
      : '',
    sponsoredActualFeeWei: sponsored.sponsoredReceipt
      ? sponsored.sponsoredReceipt.actualFeeWei.toString()
      : '',
    sponsoredActualFeeETH: sponsored.sponsoredReceipt
      ? formatEther(sponsored.sponsoredReceipt.actualFeeWei)
      : '',
    sponsoredLatencyMs: sponsored.latencyMs,

    sponsoredCallGasLimit: sponsored.gasBreakdown.callGasLimit,
    sponsoredVerificationGasLimit: sponsored.gasBreakdown.verificationGasLimit,
    sponsoredPreVerificationGas: sponsored.gasBreakdown.preVerificationGas,
    sponsoredPaymasterVerificationGasLimit:
      sponsored.gasBreakdown.paymasterVerificationGasLimit,
    sponsoredPaymasterPostOpGasLimit:
      sponsored.gasBreakdown.paymasterPostOpGasLimit,

    unsponsoredUserPaysWei: unsponsored.actualFeeWei.toString(),
    unsponsoredUserPaysETH: formatEther(unsponsored.actualFeeWei),
    sponsoredUserPaysWei: '0',
    sponsoredUserPaysETH: '0',
  });

  printRunSummary(runIndex, unsponsored, sponsored);

  return {
    unsponsoredFeeWei: unsponsored.actualFeeWei,
    sponsoredFeeWei: sponsored.sponsoredReceipt
      ? sponsored.sponsoredReceipt.actualFeeWei
      : 0n,
    unsponsoredLatencyMs: unsponsored.latencyMs,
    sponsoredLatencyMs: sponsored.latencyMs,
    sponsoredHasReceipt: Boolean(sponsored.sponsoredReceipt),
  };
}

async function main() {
  ensureCsvHeader();

  const aggregateRows: Array<{
    unsponsoredFeeWei: bigint;
    sponsoredFeeWei: bigint;
    unsponsoredLatencyMs: number;
    sponsoredLatencyMs: number;
    sponsoredHasReceipt: boolean;
  }> = [];

  printDivider('Experiment Config');
  console.log({
    runCount,
    delayMs,
    csvFile,
    account: account.address,
    toAddress,
  });

  for (let i = 1; i <= runCount; i += 1) {
    printDivider(`Starting Run ${i}`);

    const row = await runOnce(i);
    aggregateRows.push(row);

    if (i < runCount) {
      console.log(`\nWaiting ${delayMs} ms before next run...`);
      await sleep(delayMs);
    }
  }

  printFinalAggregate(aggregateRows);
}

main().catch((err) => {
  console.error('\n=== Script Failed ===');
  console.error(err);
  process.exit(1);
});
