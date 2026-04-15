import dotenv from 'dotenv';
import path from 'path';

import { privateKeyToAccount } from 'viem/accounts';
import { createPublicClient, createWalletClient, http, type Hex } from 'viem';
import { polygon } from 'viem/chains';
import { encodeFunctionData, erc20Abi, getAddress } from 'viem';

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

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:3000';
const API_KEY = process.env.X_API_KEY ?? 'my-secret-key';
const RPC_URL = process.env.RPC_URL as string | undefined;
const TEST_PRIVATE_KEY = process.env.TEST_PRIVATE_KEY as Hex | undefined;
const ZERODEV_RPC = process.env.ZERODEV_RPC as string | undefined;
const ERC20_TOKEN = getAddress('0x3c499c542cef5e3811e1192ce70d8cc03d5c3359'); // USDC on Polygon
const RECIPIENT = getAddress('0x2222222222222222222222222222222222222222');
const AMOUNT = 1n; // 1 USDC if decimals = 6

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

createWalletClient({
  account,
  chain: polygon,
  transport: http(RPC_URL),
});

async function createSigningKernelClient() {
  const entryPoint = constants.getEntryPoint('0.7');

  const kernelAccount = await createKernelAccount(publicClient, {
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

async function approveErc20ForPaymaster() {
  const { kernelClient, paymasterClient, entryPoint } =
    await createErc20KernelClient();

  const approveCall = await getERC20PaymasterApproveCall(paymasterClient, {
    gasToken: gasTokenAddresses[polygon.id]['USDC'],
    approveAmount: 1_000_000n, // 1 USDC
    entryPoint,
  });

  console.log('\n=== Step A: approve ERC20 for paymaster ===\n');
  console.log('[approve call]');
  console.dir(approveCall, { depth: null });

  const userOpHash = await (kernelClient as any).sendUserOperation({
    callData: await (kernelClient.account as any).encodeCalls([approveCall]),
  });

  console.log('[approve] userOpHash:', userOpHash);

  const receipt = await waitForUserOperationReceipt(userOpHash);
  const txHash = receipt?.receipt?.transactionHash ?? null;

  console.log('[approve] txHash:', txHash);

  return {
    userOpHash,
    txHash,
  };
}

async function sendErc20TransferWithErc20Gas() {
  const { kernelClient } = await createErc20KernelClient();

  const transferCall = {
    to: ERC20_TOKEN,
    data: encodeFunctionData({
      abi: erc20Abi,
      functionName: 'transfer',
      args: [RECIPIENT, AMOUNT],
    }),
    value: 0n,
  };

  console.log('\n=== Step B: send ERC20 transfer with ERC20 gas ===\n');
  console.log('[transfer call]');
  console.dir(transferCall, { depth: null });

  const userOpHash = await (kernelClient as any).sendUserOperation({
    callData: await (kernelClient.account as any).encodeCalls([transferCall]),
  });

  console.log('[transfer] userOpHash:', userOpHash);

  const receipt = await waitForUserOperationReceipt(userOpHash);
  const txHash = receipt?.receipt?.transactionHash ?? null;

  console.log('[transfer] txHash:', txHash);

  return {
    userOpHash,
    txHash,
  };
}

async function callPrepare(): Promise<PrepareResponse> {
  const ERC20_TOKEN = getAddress('0x3c499c542cef5e3811e1192ce70d8cc03d5c3359'); // Polygon USDC
  const RECIPIENT = getAddress('0x2222222222222222222222222222222222222222');
  const AMOUNT = 1n; // 1 USDC (6 decimals)

  const data = encodeFunctionData({
    abi: erc20Abi,
    functionName: 'transfer',
    args: [RECIPIENT, AMOUNT],
  });

  const response = await fetch(`${API_BASE_URL}/sponsorships/prepare`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': API_KEY,
    },
    body: JSON.stringify({
      from: account.address,
      to: ERC20_TOKEN, // ✅ 改成 token contract
      data, // ✅ 真正 ERC20 calldata
      value: '0', // ✅ ERC20 一定是 0
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

  const signedUserOp = {
    ...userOp,
  };

  console.log('\n[debug] signing userOp...\n');
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

  return signedUserOp;
}

async function rpc(method: string, params: any[]) {
  const response = await fetch(ZERODEV_RPC!, {
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
  const maxAttempts = 30;
  const delayMs = 2000;

  for (let i = 0; i < maxAttempts; i += 1) {
    try {
      const result = await rpc('eth_getUserOperationReceipt', [userOpHash]);

      if (result) {
        return result;
      }
    } catch {
      // ignore and retry
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  throw new Error('Timed out waiting for user operation receipt');
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

  let txHash: string | null = null;

  try {
    const receipt = await waitForUserOperationReceipt(userOpHash);
    txHash = receipt?.receipt?.transactionHash ?? null;
  } catch {
    txHash = null;
  }

  return {
    userOpHash,
    txHash,
  };
}

/*async function main() {
  console.log('\n=== Step 1: call /prepare ===\n');
  const prepareResult = await callPrepare();

  console.log('[prepare result]');
  console.dir(prepareResult, { depth: null });

  const unsignedUserOp = prepareResult.unsignedUserOp.userOp;

  console.log('\n=== Step 2: sign userOp ===\n');
  const signedUserOp = await signUserOperation(unsignedUserOp);

  console.log('[signed userOp]');
  console.dir(signedUserOp, { depth: null });

  console.log('\n=== Step 3: submit with SDK directly ===\n');
  const submitResult = await sdkSubmitUserOp(signedUserOp);

  console.log('[submit result]');
  console.dir(submitResult, { depth: null });

  if (submitResult.error) {
    console.error('\n[final] submit failed:', submitResult.error);
    return;
  }

  console.log('\n[final] submit success');
  console.log('userOpHash:', submitResult.userOpHash);
  console.log('txHash:', submitResult.txHash);
}*/

async function main() {
  const approveResult = await approveErc20ForPaymaster();

  console.log('\n[approve success]');
  console.log('userOpHash:', approveResult.userOpHash);
  console.log('txHash:', approveResult.txHash);

  const transferResult = await sendErc20TransferWithErc20Gas();

  console.log('\n[final] ERC20 gas transfer success');
  console.log('userOpHash:', transferResult.userOpHash);
  console.log('txHash:', transferResult.txHash);
}

main().catch((error) => {
  console.error('\n[script error]');
  console.error(error);
  process.exit(1);
});
