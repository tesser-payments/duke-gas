import { Injectable } from '@nestjs/common';
import {
  createPublicClient,
  createWalletClient,
  http,
  type Hex,
  type PrivateKeyAccount,
  parseAbi,
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
function serializeUserOp(userOp: any) {
  return JSON.parse(
    JSON.stringify(userOp, (_, value) =>
      typeof value === 'bigint' ? value.toString() : value,
    ),
  );
}
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
    sender: string;
    factory?: string;
    factoryData?: string;
    to?: string;
    data?: `0x${string}`;
    value?: string;
    nonce?: number;
    gasLimit?: string;
    gasPrice?: string;
    callData?: `0x${string}`;
    type?: 'verifying' | 'erc20';
  }) {
    const paymasterType = params.type ?? 'verifying';
    const entryPoint = constants.getEntryPoint('0.7');

    if (!params.to) {
      throw new Error('prepareUserOp requires params.to');
    }

    const normalizedCall = {
      to: params.to,
      data: params.data ?? '0x',
      value: params.value ?? '0',
    };

    let nonceHex: string;

    if (params.nonce !== undefined && params.nonce !== null) {
      nonceHex = this.toHex(params.nonce);
      console.log('[prepareUserOp] params.nonce override =', params.nonce);
      console.log('[prepareUserOp] nonceHex =', nonceHex);
    } else {
      try {
        const publicClient = this.getPublicClient();

        const nonceResult = await publicClient.readContract({
          address: entryPoint.address as `0x${string}`,
          abi: parseAbi([
            'function getNonce(address sender, uint192 key) view returns (uint256)',
          ]),
          functionName: 'getNonce',
          args: [params.sender as `0x${string}`, 0n],
        });

        console.log('[prepareUserOp] entryPoint.getNonce raw =', nonceResult);

        nonceHex = this.toHex(nonceResult);

        console.log('[prepareUserOp] nonceHex =', nonceHex);
      } catch (error) {
        console.error(
          '[prepareUserOp] failed to fetch nonce from EntryPoint:',
          error,
        );
        throw new Error('Failed to fetch smart account nonce');
      }
    }

    let maxFeePerGas: string;
    let maxPriorityFeePerGas: string;

    if (params.gasPrice) {
      maxFeePerGas = params.gasPrice;
      maxPriorityFeePerGas = params.gasPrice;
    } else {
      try {
        const gasPriceResult = await this.rpc(
          'zd_getUserOperationGasPrice',
          [],
        );

        console.log('[prepareUserOp] gasPriceResult =', gasPriceResult);

        const rawMaxFeePerGas = BigInt(
          gasPriceResult?.fast?.maxFeePerGas ??
            gasPriceResult?.standard?.maxFeePerGas ??
            gasPriceResult?.maxFeePerGas,
        );

        const rawMaxPriorityFeePerGas = BigInt(
          gasPriceResult?.fast?.maxPriorityFeePerGas ??
            gasPriceResult?.standard?.maxPriorityFeePerGas ??
            gasPriceResult?.maxPriorityFeePerGas,
        );

        const bump = 120n; // +20%

        maxFeePerGas = this.toHex((rawMaxFeePerGas * bump) / 100n);
        maxPriorityFeePerGas = this.toHex(
          (rawMaxPriorityFeePerGas * bump) / 100n,
        );
      } catch (error) {
        console.error(
          '[prepareUserOp] zd_getUserOperationGasPrice failed:',
          error,
        );
        throw new Error('Failed to fetch user operation gas price');
      }
    }

    const dummySignature =
      '0xfffffffffffffffffffffffffffffff0000000000000000000000000000000007aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1c';

    const userOp: any = {
      sender: params.sender,
      nonce: nonceHex,
      callData: (params.callData ?? '0x') as `0x${string}`,
      signature: dummySignature,
      maxFeePerGas,
      maxPriorityFeePerGas,
      factory: params.factory,
      factoryData: params.factoryData,
    };

    if (params.gasLimit) {
      userOp.callGasLimit = params.gasLimit;
    }
    const paymasterClient = createZeroDevPaymasterClient({
      chain: polygon,
      transport: http(this.ZERODEV_RPC),
    });

    const sponsorResult =
      paymasterType === 'erc20'
        ? await paymasterClient.sponsorUserOperation({
            userOperation: {
              ...userOp,
              entryPointAddress: entryPoint.address,
            },
            gasToken: this.POLYGON_USDC,
          })
        : await paymasterClient.sponsorUserOperation({
            userOperation: {
              ...userOp,
              entryPointAddress: entryPoint.address,
            },
          });
    console.log('[prepareUserOp] sponsorResult =', sponsorResult);
    console.log(
      '[prepareUserOp] sponsorResult keys =',
      Object.keys(sponsorResult || {}),
    );

    Object.assign(userOp, sponsorResult);

    console.log('[prepareUserOp] bumped maxFeePerGas =', userOp.maxFeePerGas);
    console.log(
      '[prepareUserOp] bumped maxPriorityFeePerGas =',
      userOp.maxPriorityFeePerGas,
    );

    console.log('[prepareUserOp] requestedFrom:', params.from);
    console.log('[prepareUserOp] requestedSender:', params.sender);
    console.log('[prepareUserOp] raw params.data:', params.data);
    console.log('[prepareUserOp] raw params.callData:', params.callData);
    console.log('[prepareUserOp] preparedSender:', userOp.sender);
    console.log('[prepareUserOp] preparedNonce:', userOp.nonce);
    console.log('[prepareUserOp] preparedCallData:', userOp.callData);
    console.log('[prepareUserOp] factory:', userOp.factory);
    console.log(
      '[prepareUserOp] factoryData exists:',
      Boolean(userOp.factoryData),
    );

    console.log('[prepareUserOp] final userOp =', userOp);
    console.log(
      '[prepareUserOp] final userOp keys =',
      Object.keys(userOp || {}),
    );
    console.log('[prepareUserOp] final maxFeePerGas =', maxFeePerGas);
    console.log(
      '[prepareUserOp] final maxPriorityFeePerGas =',
      maxPriorityFeePerGas,
    );
    return {
      stage: 'prepared',
      sponsorEnabled: true,
      sponsorType: paymasterType,
      requestedFrom: params.from,
      actualSignerAddress: params.from,
      kernelAccountAddress: params.sender,
      call: normalizedCall,
      userOp: serializeUserOp(userOp),
      note: 'Prepared from frontend-supplied sender. Frontend must sign the exact returned userOp.',
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
      console.error('[submitUserOp] failed:', error);
      return {
        userOpHash: null,
        txHash: null,
        error: error.message ?? 'unknown submit error',
      };
    }
  }
}
