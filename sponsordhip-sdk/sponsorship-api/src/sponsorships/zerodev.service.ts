import { Injectable } from '@nestjs/common';
import {
  createPublicClient,
  createWalletClient,
  http,
  type Hex,
  type PrivateKeyAccount,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  createKernelAccount,
  createKernelAccountClient,
  createZeroDevPaymasterClient,
  constants,
} from '@zerodev/sdk';
import { polygon, sepolia } from 'viem/chains';
import { getUserOperationGasPrice } from '@zerodev/sdk/actions';

@Injectable()
export class ZeroDevService {
  private readonly ZERODEV_RPC = process.env.ZERODEV_RPC as string;
  private readonly RPC_URL = process.env.RPC_URL as string;
  private readonly PRIVATE_KEY = process.env.TEST_PRIVATE_KEY as Hex;
  private readonly POLYGON_USDC =
    '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359' as const;

  constructor() {
    if (!this.ZERODEV_RPC) {
      throw new Error('Missing ZERODEV_RPC in .env');
    }

    if (!this.RPC_URL) {
      throw new Error('Missing RPC_URL in .env');
    }

    if (!this.PRIVATE_KEY) {
      throw new Error('Missing TEST_PRIVATE_KEY in .env');
    }
  }
  private async waitForUserOperationReceipt(userOpHash: string) {
    const maxAttempts = 30;
    const delayMs = 2000;

    for (let i = 0; i < maxAttempts; i += 1) {
      try {
        const result = await this.rpc('eth_getUserOperationReceipt', [
          userOpHash,
        ]);

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
  private async rpc(method: string, params: any[]) {
    const response = await fetch(this.ZERODEV_RPC, {
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
  private toHex(value: any): string {
    if (value === null || value === undefined) {
      return '0x0';
    }

    if (typeof value === 'string' && value.startsWith('0x')) {
      return value;
    }

    return `0x${BigInt(value).toString(16)}`;
  }

  getPublicClient() {
    return createPublicClient({
      chain: polygon,
      transport: http(this.RPC_URL),
    });
  }

  getLocalAccount(): PrivateKeyAccount {
    return privateKeyToAccount(this.PRIVATE_KEY);
  }

  getLocalWalletClient() {
    const account = this.getLocalAccount();

    return createWalletClient({
      account,
      chain: polygon,
      transport: http(this.RPC_URL),
    });
  }

  async sign7702Authorization() {
    const publicClient = this.getPublicClient();
    const walletClient = this.getLocalWalletClient();
    const account = this.getLocalAccount();

    const nonce = await publicClient.getTransactionCount({
      address: account.address,
      blockTag: 'pending',
    });

    // TODO: Implement proper EIP-7702 authorization signing
    // const authorization = await signAuthorization(walletClient, {
    //   contractAddress: constants.KERNEL_7702_DELEGATION_ADDRESS,
    //   nonce,
    // });
    const authorization = null;

    return {
      publicClient,
      walletClient,
      account,
      authorization,
    };
  }

  async create7702Client(
    paymasterType: 'verifying' | 'erc20' | 'none' = 'none',
  ) {
    const publicClient = this.getPublicClient();
    const account = this.getLocalAccount();

    const entryPoint = constants.getEntryPoint('0.7');

    const kernelAccount = await createKernelAccount(publicClient as any, {
      entryPoint,
      kernelVersion: constants.KERNEL_V3_3,
      eip7702Account: account,
    });

    const paymasterClient = createZeroDevPaymasterClient({
      chain: polygon,
      transport: http(this.ZERODEV_RPC),
    });

    const clientConfig: any = {
      account: kernelAccount,
      chain: polygon,
      bundlerTransport: http(this.ZERODEV_RPC),
      client: publicClient as any,
      userOperation: {
        estimateFeesPerGas: async ({ bundlerClient }: any) => {
          return getUserOperationGasPrice(bundlerClient);
        },
      },
    };

    if (paymasterType === 'verifying') {
      clientConfig.paymaster = {
        getPaymasterData: async (userOperation: any) => {
          return paymasterClient.sponsorUserOperation({ userOperation });
        },
      };
    }

    if (paymasterType === 'erc20') {
      clientConfig.paymaster = {
        getPaymasterData: async (userOperation: any) => {
          return paymasterClient.sponsorUserOperation({
            userOperation,
            gasToken: this.POLYGON_USDC,
          });
        },
      };
    }

    const kernelClient = createKernelAccountClient(clientConfig);

    return {
      publicClient,
      account,
      kernelAccount,
      kernelClient,
    };
  }

  async prepareUserOp(params: {
    from: string;
    to?: string;
    data?: `0x${string}`;
    value?: string;
    nonce?: number;
    gasLimit?: string;
    gasPrice?: string;
    type?: 'verifying' | 'erc20';
  }) {
    const paymasterType = params.type ?? 'verifying';

    const { kernelClient, account, kernelAccount } =
      await this.create7702Client(paymasterType);

    const normalizedCall = {
      to: params.to ?? null,
      data: params.data ?? '0x',
      value: params.value ?? '0',
    };

    const callData = await (kernelClient.account as any).encodeCalls([
      {
        to: params.to as `0x${string}`,
        value: BigInt(params.value ?? '0'),
        data: (params.data ?? '0x') as `0x${string}`,
      },
    ]);

    const prepareArgs: any = {
      callData,
    };

    if (params.nonce !== undefined && params.nonce !== null) {
      prepareArgs.nonce = BigInt(params.nonce);
    }

    const userOp = await (kernelClient as any).prepareUserOperation(
      prepareArgs,
    );
    // 如果外部有指定 gasLimit，就覆蓋 callGasLimit
    if (params.gasLimit) {
      userOp.callGasLimit = params.gasLimit;
    }

    // 如果外部有指定 gasPrice，就先把它套進 fee 欄位
    // 目前先採最保守做法：同時覆蓋 maxFeePerGas / maxPriorityFeePerGas
    if (params.gasPrice) {
      userOp.maxFeePerGas = params.gasPrice;
      userOp.maxPriorityFeePerGas = params.gasPrice;
    }

    return {
      stage: 'prepared',
      sponsorEnabled: true,
      sponsorType: paymasterType,
      requestedFrom: params.from,
      actualSignerAddress: account.address,
      kernelAccountAddress: kernelAccount.address,
      call: normalizedCall,
      userOp,
      note: 'ZeroDev handled gas + paymaster automatically via kernelClient. User-supplied gasLimit/gasPrice override prepared values when provided.',
    };
  }

  async submitUserOp(signedUserOp: Record<string, any>) {
    try {
      const entryPoint = constants.getEntryPoint('0.7');

      const rpcUserOp = {
        sender: signedUserOp.sender,
        nonce: this.toHex(signedUserOp.nonce),
        callData: signedUserOp.callData,
        signature: signedUserOp.signature,

        callGasLimit: this.toHex(signedUserOp.callGasLimit),
        verificationGasLimit: this.toHex(signedUserOp.verificationGasLimit),
        preVerificationGas: this.toHex(signedUserOp.preVerificationGas),

        maxFeePerGas: this.toHex(signedUserOp.maxFeePerGas),
        maxPriorityFeePerGas: this.toHex(signedUserOp.maxPriorityFeePerGas),

        paymaster: signedUserOp.paymaster,
        paymasterVerificationGasLimit: this.toHex(
          signedUserOp.paymasterVerificationGasLimit,
        ),
        paymasterPostOpGasLimit: this.toHex(
          signedUserOp.paymasterPostOpGasLimit,
        ),
        paymasterData: signedUserOp.paymasterData,

        factory: signedUserOp.factory,
        factoryData: signedUserOp.factoryData,
      };

      const eip7702Auth = signedUserOp.authorization
        ? {
            address: signedUserOp.authorization.address,
            chainId: this.toHex(signedUserOp.authorization.chainId),
            nonce: this.toHex(signedUserOp.authorization.nonce),
            r: signedUserOp.authorization.r,
            s: signedUserOp.authorization.s,
            v: this.toHex(signedUserOp.authorization.v),
            yParity: this.toHex(signedUserOp.authorization.yParity),
          }
        : undefined;

      const params = eip7702Auth
        ? [rpcUserOp, entryPoint.address, eip7702Auth]
        : [rpcUserOp, entryPoint.address];

      const userOpHash = await this.rpc('eth_sendUserOperation', params);

      let txHash: string | null = null;

      try {
        const receipt = await this.waitForUserOperationReceipt(userOpHash);
        txHash = receipt?.receipt?.transactionHash ?? null;
      } catch {
        txHash = null;
      }

      return {
        userOpHash,
        txHash,
      };
    } catch (error: any) {
      return {
        userOpHash: null,
        txHash: null,
        error: error.message ?? 'unknown submit error',
      };
    }
  }
}
