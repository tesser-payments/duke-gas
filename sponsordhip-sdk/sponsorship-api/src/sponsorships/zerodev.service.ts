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
import { getUserOperationGasPrice } from '@zerodev/sdk/actions';
import { base, polygon } from 'viem/chains';
import { encodeFunctionData, parseUnits } from 'viem';

function serializeUserOp(userOp: any) {
  return JSON.parse(
    JSON.stringify(userOp, (_, value) =>
      typeof value === 'bigint' ? value.toString() : value,
    ),
  );
}

type SupportedChainId = 137 | 8453;

type PaymasterType = 'verifying' | 'erc20';

@Injectable()
export class ZeroDevService {
  private readonly ZERODEV_RPC = process.env.ZERODEV_RPC as string;
  private readonly PRIVATE_KEY = process.env.TEST_PRIVATE_KEY as Hex;

  private readonly POLYGON_GAS_TOKEN =
    (process.env.POLYGON_GAS_TOKEN as `0x${string}` | undefined) ??
    '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359';

  private readonly BASE_GAS_TOKEN = process.env.BASE_GAS_TOKEN as
    | `0x${string}`
    | undefined;

  constructor() {
    if (!this.ZERODEV_RPC) {
      throw new Error('Missing ZERODEV_RPC in .env');
    }

    if (!this.PRIVATE_KEY) {
      throw new Error('Missing TEST_PRIVATE_KEY in .env');
    }

    if (!process.env.POLYGON_RPC_URL) {
      throw new Error('Missing POLYGON_RPC_URL in .env');
    }

    if (!process.env.BASE_RPC_URL) {
      throw new Error('Missing BASE_RPC_URL in .env');
    }
  }

  private getChain(chainId: SupportedChainId) {
    if (chainId === 137) {
      return polygon;
    }

    if (chainId === 8453) {
      return base;
    }

    throw new Error(`Unsupported chainId: ${chainId}`);
  }

  private getRpcUrl(chainId: SupportedChainId) {
    if (chainId === 137) {
      const rpcUrl = process.env.POLYGON_RPC_URL;
      if (!rpcUrl) {
        throw new Error('Missing POLYGON_RPC_URL in .env');
      }
      return rpcUrl;
    }

    if (chainId === 8453) {
      const rpcUrl = process.env.BASE_RPC_URL;
      if (!rpcUrl) {
        throw new Error('Missing BASE_RPC_URL in .env');
      }
      return rpcUrl;
    }

    throw new Error(`Unsupported chainId: ${chainId}`);
  }

  private getZeroDevRpc(chainId: SupportedChainId) {
    return `${this.ZERODEV_RPC}/chain/${chainId}`;
  }

  private getGasToken(chainId: SupportedChainId) {
    if (chainId === 137) {
      return this.POLYGON_GAS_TOKEN;
    }

    if (chainId === 8453) {
      if (!this.BASE_GAS_TOKEN) {
        throw new Error(
          'Missing BASE_GAS_TOKEN in .env for erc20 paymaster flow on Base',
        );
      }
      return this.BASE_GAS_TOKEN;
    }

    throw new Error(`Unsupported chainId: ${chainId}`);
  }

  private async rpc(chainId: SupportedChainId, method: string, params: any[]) {
    const response = await fetch(this.getZeroDevRpc(chainId), {
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

  private async waitForUserOperationReceipt(
    chainId: SupportedChainId,
    userOpHash: string,
  ) {
    const maxAttempts = 30;
    const delayMs = 2000;

    for (let i = 0; i < maxAttempts; i += 1) {
      try {
        const result = await this.rpc(chainId, 'eth_getUserOperationReceipt', [
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

  private toHex(value: any): `0x${string}` {
    if (value === null || value === undefined) {
      return '0x0';
    }

    if (typeof value === 'string' && value.startsWith('0x')) {
      return value as `0x${string}`;
    }

    return `0x${BigInt(value).toString(16)}`;
  }

  getPublicClient(chainId: SupportedChainId) {
    return createPublicClient({
      chain: this.getChain(chainId),
      transport: http(this.getRpcUrl(chainId)),
    });
  }

  getLocalAccount(): PrivateKeyAccount {
    return privateKeyToAccount(this.PRIVATE_KEY);
  }

  getLocalWalletClient(chainId: SupportedChainId) {
    const account = this.getLocalAccount();

    return createWalletClient({
      account,
      chain: this.getChain(chainId),
      transport: http(this.getRpcUrl(chainId)),
    });
  }

  async sign7702Authorization(chainId: SupportedChainId) {
    const publicClient = this.getPublicClient(chainId);
    const walletClient = this.getLocalWalletClient(chainId);
    const account = this.getLocalAccount();

    const nonce = await publicClient.getTransactionCount({
      address: account.address,
      blockTag: 'pending',
    });

    const authorization = null;

    return {
      publicClient,
      walletClient,
      account,
      authorization,
      nonce,
    };
  }

  async create7702Client(
    chainId: SupportedChainId,
    paymasterType: PaymasterType | 'none' = 'none',
  ) {
    const chain = this.getChain(chainId);
    const publicClient = this.getPublicClient(chainId);
    const account = this.getLocalAccount();
    const entryPoint = constants.getEntryPoint('0.7');

    const kernelAccount = await createKernelAccount(publicClient as any, {
      entryPoint,
      kernelVersion: constants.KERNEL_V3_3,
      eip7702Account: account,
    });

    const paymasterClient = createZeroDevPaymasterClient({
      chain,
      transport: http(this.getZeroDevRpc(chainId)),
    });

    const clientConfig: any = {
      account: kernelAccount,
      chain,
      bundlerTransport: http(this.getZeroDevRpc(chainId)),
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
            gasToken: this.getGasToken(chainId),
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
    chainId: SupportedChainId;
    from: string;
    sender: string;
    factory?: `0x${string}`;
    factoryData?: `0x${string}`;
    to?: `0x${string}`;
    data?: `0x${string}`;
    value?: string;
    nonce?: string | number;
    gasLimit?: string;
    gasPrice?: string;
    callData?: `0x${string}`;
    type?: PaymasterType;
  }) {
    const chainId = params.chainId;
    const chain = this.getChain(chainId);
    const entryPoint = constants.getEntryPoint('0.7');
    const paymasterType = params.type ?? 'verifying';
    console.log('========== PREPARE ==========');
    console.log('chainId:', chainId);
    console.log('sender:', params.sender);
    console.log('factory:', params.factory);
    console.log('factoryData:', params.factoryData);
    console.log('paymasterType:', paymasterType);

    if (!params.to) {
      throw new Error('prepareUserOp requires params.to');
    }

    if (params.nonce === undefined || params.nonce === null) {
      throw new Error('Missing frontend-supplied nonce');
    }

    const normalizedCall = {
      to: params.to,
      data: params.data ?? '0x',
      value: params.value ?? '0',
    };

    console.log('[raw call]:', {
      to: normalizedCall.to,
      dataLength: normalizedCall.data.length,
      value: normalizedCall.value,
    });

    const nonceHex = this.toHex(params.nonce);

    let maxFeePerGas: `0x${string}`;
    let maxPriorityFeePerGas: `0x${string}`;

    if (params.gasPrice) {
      maxFeePerGas = this.toHex(params.gasPrice);
      maxPriorityFeePerGas = this.toHex(params.gasPrice);
    } else {
      const gasPriceResult = await this.rpc(
        chainId,
        'zd_getUserOperationGasPrice',
        [],
      );

      console.log(
        '[gas price result]:',
        JSON.stringify(
          gasPriceResult,
          (_, value) => (typeof value === 'bigint' ? value.toString() : value),
          2,
        ),
      );

      const rawMaxFeePerGas = BigInt(
        gasPriceResult?.fast?.maxFeePerGas ??
          gasPriceResult?.standard?.maxFeePerGas ??
          gasPriceResult?.maxFeePerGas ??
          '0',
      );

      const rawMaxPriorityFeePerGas = BigInt(
        gasPriceResult?.fast?.maxPriorityFeePerGas ??
          gasPriceResult?.standard?.maxPriorityFeePerGas ??
          gasPriceResult?.maxPriorityFeePerGas ??
          '0',
      );

      console.log('[raw gas prices]:', {
        rawMaxFeePerGas: rawMaxFeePerGas.toString(),
        rawMaxPriorityFeePerGas: rawMaxPriorityFeePerGas.toString(),
      });

      const bump = 120n;

      maxFeePerGas = this.toHex((rawMaxFeePerGas * bump) / 100n);
      maxPriorityFeePerGas = this.toHex(
        (rawMaxPriorityFeePerGas * bump) / 100n,
      );

      // 如果 ZeroDev gas price 為 0，使用鏈本身的 gas price
      if (rawMaxFeePerGas === 0n || rawMaxPriorityFeePerGas === 0n) {
        console.log('[ZeroDev gas price is 0, fetching from chain]');

        const publicClient = this.getPublicClient(chainId);
        const chainGasPrice = await publicClient.getGasPrice();

        // Base 鏈通常使用 EIP-1559，設置合理的 gas price
        const baseGasPrice = chainGasPrice;
        const priorityFee = chainGasPrice / 10n; // 10% as priority fee

        maxFeePerGas = this.toHex((baseGasPrice * 120n) / 100n); // +20% buffer
        maxPriorityFeePerGas = this.toHex(priorityFee);

        console.log('[fallback gas prices]:', {
          chainGasPrice: baseGasPrice.toString(),
          maxFeePerGas,
          maxPriorityFeePerGas,
        });
      } else {
        console.log('[final gas prices]:', {
          maxFeePerGas,
          maxPriorityFeePerGas,
        });
      }
    }

    const dummySignature =
      '0xfffffffffffffffffffffffffffffff0000000000000000000000000000000007aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1c';

    const callData = (params.callData ?? '0x') as `0x${string}`;

    console.log('[callData length]:', callData.length);
    console.log('[callData preview]:', callData.slice(0, 50) + '...');

    // 驗證 callData 基本格式
    if (callData.length < 2 || !callData.startsWith('0x')) {
      throw new Error('Invalid callData format');
    }

    // 檢查是否為空 callData (只有 0x)
    if (callData === '0x') {
      console.warn(
        '[callData] WARNING: Empty callData - this might cause simulation issues',
      );
    }

    // 檢查 callData 長度是否合理 (應該是偶數，因為每個字節是 2 個 hex 字符)
    if ((callData.length - 2) % 2 !== 0) {
      throw new Error('Invalid callData: odd number of hex characters');
    }

    const userOp: any = {
      sender: params.sender,
      nonce: nonceHex,
      callData,
      signature: dummySignature,
      maxFeePerGas,
      maxPriorityFeePerGas,
      factory: params.factory,
      factoryData: params.factoryData,
    };

    if (params.gasLimit) {
      userOp.callGasLimit = this.toHex(params.gasLimit);
    }

    const zeroDevRpcUrl = this.getZeroDevRpc(chainId);
    console.log('[ZeroDev RPC URL]:', zeroDevRpcUrl);

    const paymasterClient = createZeroDevPaymasterClient({
      chain,
      transport: http(zeroDevRpcUrl),
    });

    const sponsorPayload: any = {
      userOperation: {
        ...userOp,
        entryPointAddress: entryPoint.address,
      },
    };

    if (paymasterType === 'erc20') {
      sponsorPayload.gasToken = this.getGasToken(chainId);
    }

    console.log('[userOp before sponsor]:', {
      sender: userOp.sender,
      nonce: userOp.nonce,
      factory: userOp.factory,
      factoryData: userOp.factoryData
        ? `${userOp.factoryData.slice(0, 50)}...`
        : 'undefined',
      callData: userOp.callData.slice(0, 50) + '...',
      maxFeePerGas: userOp.maxFeePerGas,
      maxPriorityFeePerGas: userOp.maxPriorityFeePerGas,
    });

    // 檢查帳戶是否已部署
    const publicClient = this.getPublicClient(chainId);
    const accountCode = await publicClient.getCode({
      address: userOp.sender as `0x${string}`,
    });
    const isDeployed = accountCode && accountCode !== '0x';

    // 檢查帳戶餘額
    const balance = await publicClient.getBalance({
      address: userOp.sender as `0x${string}`,
    });

    console.log('[account status]:', {
      address: userOp.sender,
      isDeployed,
      hasFactory: !!userOp.factory,
      hasFactoryData: !!userOp.factoryData,
      balanceWei: balance.toString(),
      balanceETH: (Number(balance) / 1e18).toFixed(6),
    });

    // 檢查 nonce 的構成
    const nonceBigInt = BigInt(userOp.nonce);
    const nonceKey = nonceBigInt >> BigInt(64);
    const nonceSequence = nonceBigInt & ((BigInt(1) << BigInt(64)) - BigInt(1));

    console.log('[nonce analysis]:', {
      rawNonce: userOp.nonce,
      nonceKey: nonceKey.toString(),
      nonceSequence: nonceSequence.toString(),
      isFirstTx: nonceSequence === 0n,
    });

    // 計算預期的 gas 成本
    const estimatedGas =
      BigInt(userOp.callGasLimit || '21000') +
      BigInt(userOp.verificationGasLimit || '200000') +
      BigInt(userOp.preVerificationGas || '50000');
    const maxCost = estimatedGas * BigInt(userOp.maxFeePerGas);

    console.log('[gas estimation]:', {
      estimatedGasUnits: estimatedGas.toString(),
      maxFeePerGas: userOp.maxFeePerGas,
      estimatedMaxCostWei: maxCost.toString(),
      estimatedMaxCostETH: (Number(maxCost) / 1e18).toFixed(6),
      accountCanAfford: balance >= maxCost,
    });

    console.log(
      '[sponsorPayload]:',
      JSON.stringify(
        sponsorPayload,
        (_, value) => (typeof value === 'bigint' ? value.toString() : value),
        2,
      ),
    );

    let sponsorResult;
    try {
      sponsorResult =
        await paymasterClient.sponsorUserOperation(sponsorPayload);
      console.log(
        '[sponsor] Raw response:',
        JSON.stringify(
          sponsorResult,
          (_, value) => (typeof value === 'bigint' ? value.toString() : value),
          2,
        ),
      );
    } catch (sponsorError: any) {
      console.error('[sponsor] Request failed:', sponsorError);
      console.error('[sponsor] Error details:', {
        message: sponsorError.message,
        code: sponsorError.code,
        data: sponsorError.data,
      });
      throw new Error(`Sponsor request failed: ${sponsorError.message}`);
    }

    // 🔥 關鍵檢查
    if (
      !sponsorResult ||
      !sponsorResult.paymaster ||
      !sponsorResult.paymasterData
    ) {
      console.error('[sponsor] FAILED - Incomplete response:', sponsorResult);
      console.error('[sponsor] Missing fields:', {
        hasPaymaster: !!sponsorResult?.paymaster,
        hasPaymasterData: !!sponsorResult?.paymasterData,
        allKeys: Object.keys(sponsorResult || {}),
      });

      throw new Error(
        'Paymaster sponsorship failed (no paymaster returned). ' +
          `Response: ${JSON.stringify(sponsorResult, (_, value) =>
            typeof value === 'bigint' ? value.toString() : value,
          )}`,
      );
    }

    console.log('[sponsor] SUCCESS:', {
      paymaster: sponsorResult.paymaster,
    });

    Object.assign(userOp, sponsorResult);

    return {
      stage: 'prepared',
      chainId,
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

  async submitUserOp(params: {
    chainId: SupportedChainId;
    signedUserOp: Record<string, any>;
  }) {
    const { chainId, signedUserOp } = params;

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

      const rpcParams = eip7702Auth
        ? [rpcUserOp, entryPoint.address, eip7702Auth]
        : [rpcUserOp, entryPoint.address];

      const userOpHash = await this.rpc(
        chainId,
        'eth_sendUserOperation',
        rpcParams,
      );

      let txHash: string | null = null;

      try {
        const receipt = await this.waitForUserOperationReceipt(
          chainId,
          userOpHash,
        );
        txHash = receipt?.receipt?.transactionHash ?? null;
      } catch {
        txHash = null;
      }

      return {
        chainId,
        userOpHash,
        txHash,
      };
    } catch (error: any) {
      console.error('[submitUserOp] failed:', error);
      return {
        chainId,
        userOpHash: null,
        txHash: null,
        error: error.message ?? 'unknown submit error',
      };
    }
  }
}
