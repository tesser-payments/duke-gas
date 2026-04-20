# Gas Sponsorship API Technical Implementation Report

## Project Overview

This project implements a Gas Sponsorship API based on ZeroDev SDK, supporting ERC-4337 Account Abstraction on Polygon network, providing gas fee sponsorship functionality and cost comparison analysis.

---

## Task Objectives

### Main Requirements

1. **ERC20 Transfer Support**: Ensure data field corresponds to actual ERC20 transfer operations
2. **Polygon Network**: Send transactions on Polygon network
3. **Gas Parameter Support**: POST `/sponsorships/prepare` supports optional gasLimit and gasPrice parameters
4. **ERC20 Paymaster**: Support `type = verifying | erc20` parameter, providing two different paymaster modes

**verifying paymaster**

- Gas paid by sponsor (platform)

User pays: 0
Platform pays: all gas
Paymaster: "verifies" the transaction

**erc20 paymaster**

- Gas paid with token (USDC)

gasToken: this.POLYGON_USDC
User pays: USDC
Platform: no subsidies needed
Paymaster: converts token → gas for you

5. **Cost Comparison**: Compare costs of unsponsored, sponsored-verifying, and erc20 modes, denominated in USD
6. **Server Deployment**: Deploy to internet environment (planned to use Render)

---

## Test Flow

### API Test Flow

1. **Prepare Phase**:
   - Call `POST /sponsorships/prepare` to prepare UserOperation
   - Support gasLimit, gasPrice, type parameters
   - Return unsigned UserOperation

2. **Submit Phase**:
   - Call `POST /sponsorships/submit` to submit signed UserOperation
   - Return userOpHash and txHash

### Cost Comparison Test Flow

`compare-costs.ts` automated test script executes the following flow:

1. **Initialization Setup**
   - Configure Polygon network connection
   - Set up test account and ERC20 token addresses
   - Initialize CSV result file

2. **Three Mode Testing**：
   - **Unsponsored**: Use wallet client to send ERC20 transfer transactions directly
   - **Verifying**: Use ZeroDev verifying paymaster to sponsor gas
   - **ERC20**: Use USDC as gas token with ERC20 paymaster

3. **Automated Execution**：
   - Execute one test round every 30 minutes (total 24 rounds, 12 hours)
   - Record detailed data for each transaction

---

## Detailed Technical Implementation

### 1. ZeroDevService.ts Core Architecture

#### A. Service Configuration and Initialization

```typescript
// src/sponsorships/zerodev.service.ts:21-38
@Injectable()
export class ZeroDevService {
  private readonly ZERODEV_RPC = process.env.ZERODEV_RPC as string;
  private readonly RPC_URL = process.env.RPC_URL as string;
  private readonly PRIVATE_KEY = process.env.TEST_PRIVATE_KEY as Hex;
  private readonly POLYGON_USDC = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359';

  constructor() {
    // Environment variable validation
    if (!this.ZERODEV_RPC || !this.RPC_URL || !this.PRIVATE_KEY) {
      throw new Error('Missing required environment variables');
    }
  }
}
```

**Configuration Explanation**:

- `ZERODEV_RPC`: ZeroDev bundler + paymaster endpoint
- `RPC_URL`: Polygon network RPC endpoint
- `PRIVATE_KEY`: EIP-7702 delegation signing private key
- `POLYGON_USDC`: Token address used by ERC20 paymaster

#### B. Three-Layer Client Architecture

```typescript
// src/sponsorships/zerodev.service.ts:98-117
// 1. Read on-chain state
getPublicClient() {
  return createPublicClient({
    chain: polygon,
    transport: http(this.RPC_URL),
  });
}

// 2. Private key management
getLocalAccount(): PrivateKeyAccount {
  return privateKeyToAccount(this.PRIVATE_KEY);
}

// 3. Transaction sending
getLocalWalletClient() {
  const account = this.getLocalAccount();
  return createWalletClient({
    account, chain: polygon, transport: http(this.RPC_URL)
  });
}
```

#### C. EIP-7702 Smart Account Creation

```typescript
// src/sponsorships/zerodev.service.ts:144-202
async create7702Client(paymasterType: 'verifying' | 'erc20' | 'none' = 'none') {
  const publicClient = this.getPublicClient();
  const account = this.getLocalAccount();
  const entryPoint = constants.getEntryPoint('0.7');

  // Create Kernel smart contract account
  const kernelAccount = await createKernelAccount(publicClient, {
    entryPoint,
    kernelVersion: constants.KERNEL_V3_3,
    eip7702Account: account,  // EOA -> Smart Account conversion
  });

  // Configure different Paymasters
  const clientConfig = {
    account: kernelAccount,
    chain: polygon,
    bundlerTransport: http(this.ZERODEV_RPC),
    client: publicClient,
    userOperation: {
      estimateFeesPerGas: async ({ bundlerClient }) => {
        return getUserOperationGasPrice(bundlerClient);
      },
    },
  };

  // Verifying Paymaster - ZeroDev free sponsorship
  if (paymasterType === 'verifying') {
    clientConfig.paymaster = {
      getPaymasterData: async (userOperation) => {
        return paymasterClient.sponsorUserOperation({ userOperation });
      },
    };
  }

  // ERC20 Paymaster - Pay with USDC
  if (paymasterType === 'erc20') {
    clientConfig.paymaster = {
      getPaymasterData: async (userOperation) => {
        return paymasterClient.sponsorUserOperation({
          userOperation,
          gasToken: this.POLYGON_USDC,
        });
      },
    };
  }

  return createKernelAccountClient(clientConfig);
}
```

#### D. Gas Parameter Override Mechanism

```typescript
// src/sponsorships/zerodev.service.ts:241-266
async prepareUserOp(params) {
  const paymasterType = params.type ?? 'verifying';
  const { kernelClient, account, kernelAccount } = await this.create7702Client(paymasterType);

  // Encode call data
  const callData = await kernelClient.account.encodeCalls([{
    to: params.to as `0x${string}`,
    value: BigInt(params.value ?? '0'),
    data: (params.data ?? '0x') as `0x${string}`,
  }]);

  // ZeroDev automatic gas parameter estimation
  const userOp = await kernelClient.prepareUserOperation({ callData });

  // External parameter override logic
  if (params.gasLimit) {
    userOp.callGasLimit = params.gasLimit;  // Execution gas limit
  }

  if (params.gasPrice) {
    // EIP-1559 fee structure
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
    call: { to: params.to ?? null, data: params.data ?? '0x', value: params.value ?? '0' },
    userOp,
    note: 'ZeroDev handled gas + paymaster automatically. User-supplied parameters override prepared values.',
  };
}
```

### 2. Compare-costs.ts Test Architecture

#### A. Test Configuration and Environment

```typescript
// script/compare-costs.ts:77-98
const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:3000';
const API_KEY = process.env.X_API_KEY ?? 'my-secret-key';
const NATIVE_TOKEN_USD_PRICE = 0.7; // POL/MATIC hardcoded price
const ERC20_TOKEN = getAddress('0x3c499c542cef5e3811e1192ce70d8cc03d5c3359'); // Polygon USDC
const RECIPIENT = getAddress('0x2222222222222222222222222222222222222222');
const AMOUNT = 1n; // 1 wei ≈ 0.000001 USDC

// Test scheduling configuration
const INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const TOTAL_RUNS = 24; // 12 hours total test time
```

#### B. Three Test Mode Implementation Differences

**Mode 1: Unsponsored (Baseline Test)**

```typescript
// script/compare-costs.ts:384-414
async function runUnsponsored(): Promise<CompareRow> {
  const walletClient = createWalletClient({
    account: privateKeyToAccount(TEST_PRIVATE_KEY),
    chain: polygon,
    transport: http(RPC_URL),
  });

  const start = Date.now();

  // Send ERC20 transfer transaction directly
  const hash = await walletClient.sendTransaction({
    to: ERC20_TOKEN,
    data: buildTransferData(), // encodeFunctionData(erc20Abi, 'transfer', [RECIPIENT, AMOUNT])
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const latencyMs = Date.now() - start;

  return {
    mode: 'unsponsored',
    txHash: hash,
    latencyMs,
    ...parseReceipt(receipt),
  };
}
```

**Mode 2: Verifying Sponsored (API Test Path)**

```typescript
// script/compare-costs.ts:265-290 + 422-458
// Step 1: Prepare UserOperation through API
async function callPrepareVerifying(): Promise<PrepareResponse> {
  const response = await fetch(`${API_BASE_URL}/sponsorships/prepare`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-KEY': API_KEY },
    body: JSON.stringify({
      from: account.address,
      to: ERC20_TOKEN,
      data: buildTransferData(),
      value: '0',
      type: 'verifying', // Use ZeroDev free paymaster
    }),
  });
  return response.json();
}

// Step 2: Local signing
async function signUserOperation(userOp: Record<string, any>) {
  const { kernelClient } = await createSigningKernelClient();
  const realSignature = await kernelClient.account.signUserOperation(userOp);
  return { ...userOp, signature: realSignature };
}

// Step 3: SDK submission (bypass API)
async function sdkSubmitUserOp(signedUserOp: Record<string, any>) {
  const { kernelClient } = await createSigningKernelClient();
  const userOpHash = await kernelClient.sendUserOperation(signedUserOp);
  const receipt = await waitForUserOperationReceipt(userOpHash);
  return { userOpHash, txHash: receipt?.receipt?.transactionHash };
}
```

**Mode 3: ERC20 Paymaster (Direct SDK Path)**

```typescript
// script/compare-costs.ts:232-262 + 460-496
// ERC20 client configuration - independent of API
async function createErc20KernelClient() {
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

  return createKernelAccountClient({
    account: kernelAccount,
    chain: polygon,
    bundlerTransport: http(ZERODEV_RPC),
    client: publicClient,
    userOperation: {
      estimateFeesPerGas: async ({ bundlerClient }) => {
        return getUserOperationGasPrice(bundlerClient);
      },
    },
    paymaster: paymasterClient,
    paymasterContext: {
      token: gasTokenAddresses[polygon.id]['USDC'], // Direct USDC specification
    },
  });
}

// Integrated execution flow
async function runErc20(): Promise<CompareRow> {
  const { kernelClient } = await createErc20KernelClient();
  const start = Date.now();

  const userOpHash = await kernelClient.sendUserOperation({
    callData: await kernelClient.account.encodeCalls([
      {
        to: ERC20_TOKEN,
        data: buildTransferData(),
        value: 0n,
      },
    ]),
  });

  const receiptOp = await waitForUserOperationReceipt(userOpHash);
  const receipt = await publicClient.getTransactionReceipt({
    hash: receiptOp.receipt.transactionHash,
  });

  return {
    mode: 'erc20',
    txHash: receiptOp.receipt.transactionHash,
    latencyMs: Date.now() - start,
    ...parseReceipt(receipt),
  };
}
```

#### C. Cost Calculation and Data Collection

```typescript
// script/compare-costs.ts:125-153
function calcNativeCost(gasUsed: bigint, effectiveGasPrice: bigint) {
  const nativeCostWei = gasUsed * effectiveGasPrice;
  const nativeCostToken = Number(nativeCostWei) / 1e18; // Wei -> POL/MATIC
  const costUSD = nativeCostToken * NATIVE_TOKEN_USD_PRICE; // POL -> USD

  return { nativeCostWei: nativeCostWei.toString(), nativeCostToken, costUSD };
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
```

#### D. Automated Test Scheduling

```typescript
// script/compare-costs.ts:549-617
async function main() {
  const INTERVAL_MS = 30 * 60 * 1000; // 30-minute interval
  const TOTAL_RUNS = 24; // Total 24 rounds = 12 hours

  // Initial setup: authorize ERC20 paymaster
  await ensureErc20Approval();

  for (let i = 1; i <= TOTAL_RUNS; i++) {
    console.log(`\n===== RUN ${i}/${TOTAL_RUNS} =====\n`);
    const results: CompareRow[] = [];

    // Fault-tolerant execution of three modes
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

    // Immediate CSV write
    appendCSV(i, results);

    // Wait for next round (except last)
    if (i < TOTAL_RUNS) {
      await new Promise((res) => setTimeout(res, INTERVAL_MS));
    }
  }
}
```

---

## Results.csv Data Analysis

### Data Overview

From the test results, the following key metrics can be observed:

| Mode        | Average Gas Usage | Average Gas Price (Wei) | Average Cost (USD) | Average Latency (ms) |
| ----------- | ----------------- | ----------------------- | ------------------ | -------------------- |
| Unsponsored | 45,035            | ~124,700,000,000        | ~$0.0039           | ~2,800               |
| Verifying   | 133,808           | ~250,000,000,000        | ~$0.026            | ~6,000               |
| ERC20       | 170,716           | ~235,000,000,000        | ~$0.033            | ~17,500              |

### Key Findings

#### 1. Gas Usage Analysis

- **Unsponsored**: 45,035 gas (baseline)
- **Verifying**: 133,808 gas (+197% increase)
- **ERC20**: 170,716 gas (+279% increase)

#### 2. Cost Comparison

- **Cheapest**: Unsponsored (~$0.0039)
- **Medium**: Verifying sponsored (~$0.026, ~6.7x)
- **Most Expensive**: ERC20 paymaster (~$0.033, ~8.5x)

#### 3. Latency Analysis

- **Unsponsored**: ~2.8 seconds
- **Verifying**: ~6 seconds (+114% increase)
- **ERC20**: ~17.5 seconds (+525% increase)

#### 4. Price Stability

- Unsponsored transaction prices are relatively stable
- Sponsored transactions are more affected by network gas price fluctuations
- ERC20 paymaster latency varies significantly (5-52 seconds)

---

## System Architecture and Data Flow Analysis

### 1. Overall Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    compare-costs.ts                         │
│                   (Independent Test Script)                 │
│                                                             │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────┐ │
│  │ Unsponsored │  │  Verifying   │  │    ERC20 Paymaster  │ │
│  │   (Direct)  │  │  (API Path)  │  │    (Direct SDK)     │ │
│  └─────────────┘  └──────┬───────┘  └─────────────────────┘ │
└─────────────────────────┼─────────────────────────────────────┘
                          │ HTTP API Call
                          │
┌─────────────────────────▼─────────────────────────────────────┐
│                NestJS API Server                              │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │            sponsorships.controller.ts                   │ │
│  │                                                         │ │
│  │   POST /sponsorships/prepare                            │ │
│  │   POST /sponsorships/submit                             │ │
│  └─────────────────┬───────────────────────────────────────┘ │
│                    │                                         │
│  ┌─────────────────▼───────────────────────────────────────┐ │
│  │            sponsorships.service.ts                      │ │
│  │                                                         │ │
│  │   prepare() -> zeroDevService.prepareUserOp()          │ │
│  │   submit() -> zeroDevService.submitUserOp()            │ │
│  └─────────────────┬───────────────────────────────────────┘ │
│                    │                                         │
│  ┌─────────────────▼───────────────────────────────────────┐ │
│  │              zerodev.service.ts                         │ │
│  │                                                         │ │
│  │   prepareUserOp() - Prepare UserOperation              │ │
│  │   submitUserOp() - Submit UserOperation                │ │
│  │   create7702Client() - Create different paymaster clients │ │
│  └─────────────────┬───────────────────────────────────────┘ │
└────────────────────┼─────────────────────────────────────────┘
                     │ ZeroDev SDK Call
                     │
┌────────────────────▼─────────────────────────────────────────┐
│                 ZeroDev Infrastructure                       │
│                                                              │
│   Bundler ←→ Paymaster ←→ Polygon Network                   │
└──────────────────────────────────────────────────────────────┘
```

### 2. Technical Path Differences Between Test Modes

| Mode            | Technical Path      | Configuration Source | Features                          |
| --------------- | ------------------- | -------------------- | --------------------------------- |
| **Unsponsored** | Direct WalletClient | compare-costs.ts     | Baseline test, simplest           |
| **Verifying**   | API → SDK Hybrid    | zerodev.service.ts   | Test API endpoint completeness    |
| **ERC20**       | Pure SDK            | compare-costs.ts     | Independent configuration, no API |

### 3. Key Differences: Hybrid Architecture Impact

#### A. Verifying Mode Hybrid Flow

```typescript
// Step 1: Prepare UserOperation through API
const prepared = await fetch('/sponsorships/prepare', {
  body: JSON.stringify({ type: 'verifying', ...params }),
});

// Step 2: Local signing (skip API)
const signed = await localSignUserOperation(prepared.userOp);

// Step 3: Direct SDK submission (skip API)
const result = await kernelClient.sendUserOperation(signed);
```

**Advantages**: Test API preparation logic correctness  
**Disadvantages**: Does not test complete API workflow (`POST /sponsorships/submit`)

#### B. ERC20 Mode Pure SDK Flow

```typescript
// Integrated: configuration → execution → submission
const kernelClient = await createErc20KernelClient(); // Independent configuration
const userOpHash = await kernelClient.sendUserOperation(callData);
```

**Advantages**: Test SDK functionality completeness  
**Disadvantages**: Does not test API's ERC20 paymaster support

#### C. Reasons for Using This Approach Currently:

It helps us first confirm:

1. Whether /sponsorships/prepare prepares correctly

2. Whether userOp format is correct
3. Whether local sign can succeed
   Whether SDK can finally send it out
4. Whether ZeroDev SDK supports ERC20 paymaster
5. Whether gasToken configuration is correct
6. Whether the entire sponsor flow can run through

So it's very suitable for debugging phase.

But it's not suitable as the main flow for final reporting because:

It doesn't fully test /sponsorships/submit

### 4. Configuration Management Analysis

#### A. Duplicate Configuration Risk

```typescript
// zerodev.service.ts (API usage)
private readonly POLYGON_USDC = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359';

// compare-costs.ts (test script usage)
const ERC20_TOKEN = getAddress('0x3c499c542cef5e3811e1192ce70d8cC03d5c3359');
```

**Potential Issues**:

- Maintaining same configuration in two places, easy to get out of sync
- Test environment and production environment might use different token addresses

#### B. Gas Parameter Handling Differences

```typescript
// API path - supports parameter override
if (params.gasLimit) userOp.callGasLimit = params.gasLimit;
if (params.gasPrice) userOp.maxFeePerGas = params.gasPrice;

// Direct SDK path - uses default values
const userOp = await kernelClient.prepareUserOperation({ callData });
```

**Impact**: ERC20 testing cannot verify gas parameter override functionality

### 5. API Architecture Details

```
├── src/sponsorships/
│   ├── sponsorships.controller.ts    # HTTP endpoints, API Key validation
│   ├── sponsorships.service.ts       # Business logic, BigInt serialization
│   ├── zerodev.service.ts           # ZeroDev SDK integration, core logic
│   └── dto/
│       ├── prepare.dto.ts           # gasLimit, gasPrice, type parameters
│       └── submit.dto.ts            # signedUserOp parameters
```

### 6. Test Architecture Details

```
├── script/
│   ├── compare-costs.ts             # Main test script
│   │   ├── runUnsponsored()         # Baseline test
│   │   ├── runVerifying()           # API + SDK hybrid
│   │   └── runErc20()               # Pure SDK test
│   └── test-sponsored-flow.ts       # Function verification script
├── results.csv                      # Auto-generated data
└── CompareGas.md                   # Manual analysis report
```

---

## Conclusion

### Completed Features

1. **ERC20 Transfer Support**: Complete implementation using standard ERC20 ABI
2. **Polygon Network**: Full Polygon network support
3. **Gas Parameter Support**: Complete gasLimit and gasPrice implementation
4. **ERC20 Paymaster**: Support for both verifying and erc20 modes
5. **Cost Comparison**: Complete USD cost calculation and comparison analysis

### Technical Highlights

- Uses ZeroDev SDK to provide enterprise-grade Account Abstraction solution
- Supports flexible paymaster configuration
- Complete cost tracking and analysis system
- Automated testing and data collection

### Goals 🚧

- **Server Deployment**: Not yet deployed to Render or other cloud platforms

I hope to eventually unify the sponsorship flow to API prepare → frontend wallet signing → API submit.

This design allows the backend to handle gas estimation, paymaster selection, and on-chain submission, while preserving user-side signing security, and is closer to a real product's account abstraction workflow.

so it looks like this:

if a user wants to perform an ERC20 transfer:

The frontend first sends to, data, value, and type to /sponsorships/prepare.
The backend then returns a prepared userOp.
Next, the frontend uses the user’s wallet to sign the operation.
After that, the signed userOp is sent to /sponsorships/submit.
Finally, the backend submits it to the bundler and returns the userOpHash and the final txHash.

```
[Frontend User]
|
| 1. POST /sponsorships/prepare
v
[Backend API] - build unsigned UserOperation - estimate gas - choose paymaster (verifying / erc20)
|
| return prepared userOp
v
[Frontend Wallet] - user reviews request - signs userOp
|
| 2. POST /sponsorships/submit
v
[Backend API] - receive signed userOp - send to bundler / entry point - wait for userOpHash / txHash
|
v
[Blockchain / Bundler]
```

### Cost-Benefit Analysis

- **User Experience**: ERC20 paymaster provides the best user experience (no need to hold native tokens)
- **Cost Consideration**: Sponsored transaction costs are 6.7-8.5 times that of native transactions
- **Latency Trade-off**: Sponsored transactions have higher latency, especially ERC20 paymaster
