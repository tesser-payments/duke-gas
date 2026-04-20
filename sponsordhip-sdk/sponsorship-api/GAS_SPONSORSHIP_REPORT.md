# Gas Sponsorship API 技術實作報告

## 專案概述

本專案實作一個基於 ZeroDev SDK 的 Gas Sponsorship API，支援 Polygon 網路上的 ERC-4337 Account Abstraction，提供 gas 費用代付功能和成本比較分析。

---

## 任務目標

### 主要需求

1. **ERC20 轉帳支援**: 確保 data field 對應實際的 ERC20 transfer 操作
2. **Polygon 網路**: 在 Polygon 網路上發送交易
3. **Gas 參數支援**: POST `/sponsorships/prepare` 支援可選的 gasLimit 和 gasPrice 參數
4. **ERC20 Paymaster**: 支援 `type = verifying | erc20` 參數，提供兩種不同的 paymaster 模式

🟢 verifying paymaster

👉 gas 由 sponsor（平台）出

使用者付：0
平台付：全部 gas
Paymaster：會「驗證」交易

👉 本質：

Web2 UX（免費交易）

🟡 erc20 paymaster

👉 gas 用 token（USDC）付

gasToken: this.POLYGON_USDC
使用者付：USDC
平台：不用補貼
Paymaster：幫你轉換 token → gas

👉 本質：

Web3 UX（用 token 付 gas）

5. **成本比較**: 比較 unsponsored、sponsored-verifying 和 erc20 三種模式的成本，以 USD 計價
6. **服務器部署**: 部署到網路環境（計劃使用 Render）

---

## 測試流程

### API 測試流程

1. **Prepare 階段**:
   - 呼叫 `POST /sponsorships/prepare` 準備 UserOperation
   - 支援 gasLimit、gasPrice、type 等參數
   - 返回未簽名的 UserOperation

2. **Submit 階段**:
   - 呼叫 `POST /sponsorships/submit` 提交已簽名的 UserOperation
   - 返回 userOpHash 和 txHash

### 成本比較測試流程

`compare-costs.ts` 自動化測試腳本執行以下流程：

1. **初始化設定**
   - 配置 Polygon 網路連線
   - 設定測試帳戶和 ERC20 代幣地址
   - 初始化 CSV 結果檔案

2. **三種模式測試**：
   - **Unsponsored**: 直接使用錢包發送 ERC20 transfer 交易
   - **Verifying**: 使用 ZeroDev verifying paymaster 代付 gas
   - **ERC20**: 使用 USDC 作為 gas token 的 ERC20 paymaster

3. **自動化執行**：
   - 每 30 分鐘執行一輪測試（共 24 輪，12 小時）
   - 記錄每次交易的詳細數據

---

## 技術實作方法詳解

### 1. ZeroDevService.ts 核心架構

#### A. 服務配置與初始化

```typescript
// src/sponsorships/zerodev.service.ts:21-38
@Injectable()
export class ZeroDevService {
  private readonly ZERODEV_RPC = process.env.ZERODEV_RPC as string;
  private readonly RPC_URL = process.env.RPC_URL as string;
  private readonly PRIVATE_KEY = process.env.TEST_PRIVATE_KEY as Hex;
  private readonly POLYGON_USDC = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359';

  constructor() {
    // 環境變數驗證
    if (!this.ZERODEV_RPC || !this.RPC_URL || !this.PRIVATE_KEY) {
      throw new Error('Missing required environment variables');
    }
  }
}
```

**配置說明**:

- `ZERODEV_RPC`: ZeroDev bundler + paymaster 端點
- `RPC_URL`: Polygon 網路 RPC 端點
- `PRIVATE_KEY`: EIP-7702 委託簽名私鑰
- `POLYGON_USDC`: ERC20 paymaster 使用的代幣地址

#### B. 三層客戶端架構

```typescript
// src/sponsorships/zerodev.service.ts:98-117
// 1. 讀取鏈上狀態
getPublicClient() {
  return createPublicClient({
    chain: polygon,
    transport: http(this.RPC_URL),
  });
}

// 2. 私鑰管理
getLocalAccount(): PrivateKeyAccount {
  return privateKeyToAccount(this.PRIVATE_KEY);
}

// 3. 交易發送
getLocalWalletClient() {
  const account = this.getLocalAccount();
  return createWalletClient({
    account, chain: polygon, transport: http(this.RPC_URL)
  });
}
```

#### C. EIP-7702 智能合約帳戶創建

```typescript
// src/sponsorships/zerodev.service.ts:144-202
async create7702Client(paymasterType: 'verifying' | 'erc20' | 'none' = 'none') {
  const publicClient = this.getPublicClient();
  const account = this.getLocalAccount();
  const entryPoint = constants.getEntryPoint('0.7');

  // 創建 Kernel 智能合約帳戶
  const kernelAccount = await createKernelAccount(publicClient, {
    entryPoint,
    kernelVersion: constants.KERNEL_V3_3,
    eip7702Account: account,  // EOA -> Smart Account 轉換
  });

  // 配置不同的 Paymaster
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

  // Verifying Paymaster - ZeroDev 免費代付
  if (paymasterType === 'verifying') {
    clientConfig.paymaster = {
      getPaymasterData: async (userOperation) => {
        return paymasterClient.sponsorUserOperation({ userOperation });
      },
    };
  }

  // ERC20 Paymaster - 使用 USDC 支付
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

#### D. Gas 參數覆蓋機制

```typescript
// src/sponsorships/zerodev.service.ts:241-266
async prepareUserOp(params) {
  const paymasterType = params.type ?? 'verifying';
  const { kernelClient, account, kernelAccount } = await this.create7702Client(paymasterType);

  // 編碼呼叫數據
  const callData = await kernelClient.account.encodeCalls([{
    to: params.to as `0x${string}`,
    value: BigInt(params.value ?? '0'),
    data: (params.data ?? '0x') as `0x${string}`,
  }]);

  // ZeroDev 自動估算 gas 參數
  const userOp = await kernelClient.prepareUserOperation({ callData });

  // 外部參數覆蓋邏輯
  if (params.gasLimit) {
    userOp.callGasLimit = params.gasLimit;  // 執行 gas 限制
  }

  if (params.gasPrice) {
    // EIP-1559 fee 結構
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

### 2. Compare-costs.ts 測試架構

#### A. 測試配置與環境

```typescript
// script/compare-costs.ts:77-98
const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:3000';
const API_KEY = process.env.X_API_KEY ?? 'my-secret-key';
const NATIVE_TOKEN_USD_PRICE = 0.7; // POL/MATIC 硬編碼價格
const ERC20_TOKEN = getAddress('0x3c499c542cef5e3811e1192ce70d8cc03d5c3359'); // Polygon USDC
const RECIPIENT = getAddress('0x2222222222222222222222222222222222222222');
const AMOUNT = 1n; // 1 wei ≈ 0.000001 USDC

// 測試排程配置
const INTERVAL_MS = 30 * 60 * 1000; // 30 分鐘
const TOTAL_RUNS = 24; // 12 小時總測試時間
```

#### B. 三種測試模式實作差異

**模式 1: Unsponsored (基準測試)**

```typescript
// script/compare-costs.ts:384-414
async function runUnsponsored(): Promise<CompareRow> {
  const walletClient = createWalletClient({
    account: privateKeyToAccount(TEST_PRIVATE_KEY),
    chain: polygon,
    transport: http(RPC_URL),
  });

  const start = Date.now();

  // 直接發送 ERC20 transfer 交易
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

**模式 2: Verifying Sponsored (API 測試路徑)**

```typescript
// script/compare-costs.ts:265-290 + 422-458
// 步驟 1: 通過 API 準備 UserOperation
async function callPrepareVerifying(): Promise<PrepareResponse> {
  const response = await fetch(`${API_BASE_URL}/sponsorships/prepare`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-KEY': API_KEY },
    body: JSON.stringify({
      from: account.address,
      to: ERC20_TOKEN,
      data: buildTransferData(),
      value: '0',
      type: 'verifying', // 使用 ZeroDev 免費 paymaster
    }),
  });
  return response.json();
}

// 步驟 2: 本地簽名
async function signUserOperation(userOp: Record<string, any>) {
  const { kernelClient } = await createSigningKernelClient();
  const realSignature = await kernelClient.account.signUserOperation(userOp);
  return { ...userOp, signature: realSignature };
}

// 步驟 3: SDK 提交 (繞過 API)
async function sdkSubmitUserOp(signedUserOp: Record<string, any>) {
  const { kernelClient } = await createSigningKernelClient();
  const userOpHash = await kernelClient.sendUserOperation(signedUserOp);
  const receipt = await waitForUserOperationReceipt(userOpHash);
  return { userOpHash, txHash: receipt?.receipt?.transactionHash };
}
```

**模式 3: ERC20 Paymaster (直接 SDK 路徑)**

```typescript
// script/compare-costs.ts:232-262 + 460-496
// ERC20 客戶端配置 - 獨立於 API
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
      token: gasTokenAddresses[polygon.id]['USDC'], // 直接指定 USDC
    },
  });
}

// 一體化執行流程
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

#### C. 成本計算與數據收集

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

#### D. 自動化測試排程

```typescript
// script/compare-costs.ts:549-617
async function main() {
  const INTERVAL_MS = 30 * 60 * 1000; // 30 分鐘間隔
  const TOTAL_RUNS = 24; // 總共 24 輪 = 12 小時

  // 初始設定：授權 ERC20 paymaster
  await ensureErc20Approval();

  for (let i = 1; i <= TOTAL_RUNS; i++) {
    console.log(`\n===== RUN ${i}/${TOTAL_RUNS} =====\n`);
    const results: CompareRow[] = [];

    // 容錯執行三種模式
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

    // 立即寫入 CSV
    appendCSV(i, results);

    // 等待下一輪 (除了最後一輪)
    if (i < TOTAL_RUNS) {
      await new Promise((res) => setTimeout(res, INTERVAL_MS));
    }
  }
}
```

---

## Results.csv 數據分析

### 數據概況

從測試結果可以看出以下關鍵指標：

| 模式        | 平均 Gas 使用量 | 平均 Gas 價格 (Wei) | 平均成本 (USD) | 平均延遲 (ms) |
| ----------- | --------------- | ------------------- | -------------- | ------------- |
| Unsponsored | 45,035          | ~124,700,000,000    | ~$0.0039       | ~2,800        |
| Verifying   | 133,808         | ~250,000,000,000    | ~$0.026        | ~6,000        |
| ERC20       | 170,716         | ~235,000,000,000    | ~$0.033        | ~17,500       |

### 關鍵發現

#### 1. Gas 使用量分析

- **Unsponsored**: 45,035 gas（基準）
- **Verifying**: 133,808 gas（+197% 增加）
- **ERC20**: 170,716 gas（+279% 增加）

#### 2. 成本比較

- **最便宜**: Unsponsored (~$0.0039)
- **中等**: Verifying sponsored (~$0.026，約 6.7x)
- **最貴**: ERC20 paymaster (~$0.033，約 8.5x)

#### 3. 延遲分析

- **Unsponsored**: ~2.8秒
- **Verifying**: ~6秒（+114% 增加）
- **ERC20**: ~17.5秒（+525% 增加）

#### 4. 價格穩定性

- Unsponsored 交易價格相對穩定
- Sponsored 交易受網路 gas 價格波動影響較大
- ERC20 paymaster 延遲變化較大（5-52秒）

---

## 系統架構與數據流分析

### 1. 整體架構關係圖

```
┌─────────────────────────────────────────────────────────────┐
│                    compare-costs.ts                         │
│                   (獨立測試腳本)                               │
│                                                             │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────┐ │
│  │ Unsponsored │  │  Verifying   │  │    ERC20 Paymaster  │ │
│  │   (直接)     │  │  (API路徑)    │  │    (直接SDK)        │ │
│  └─────────────┘  └──────┬───────┘  └─────────────────────┘ │
└─────────────────────────┼─────────────────────────────────────┘
                          │ HTTP API 呼叫
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
│  │   prepareUserOp() - 準備 UserOperation                  │ │
│  │   submitUserOp() - 提交 UserOperation                   │ │
│  │   create7702Client() - 建立不同 paymaster 客戶端          │ │
│  └─────────────────┬───────────────────────────────────────┘ │
└────────────────────┼─────────────────────────────────────────┘
                     │ ZeroDev SDK 呼叫
                     │
┌────────────────────▼─────────────────────────────────────────┐
│                 ZeroDev Infrastructure                       │
│                                                              │
│   Bundler ←→ Paymaster ←→ Polygon Network                   │
└──────────────────────────────────────────────────────────────┘
```

### 2. 測試模式的技術路徑差異

| 模式            | 技術路徑          | 配置來源           | 特點                 |
| --------------- | ----------------- | ------------------ | -------------------- |
| **Unsponsored** | 直接 WalletClient | compare-costs.ts   | 基準測試，最簡單     |
| **Verifying**   | API → SDK 混合    | zerodev.service.ts | 測試 API 端點完整性  |
| **ERC20**       | 純 SDK            | compare-costs.ts   | 獨立配置，不通過 API |

### 3. 關鍵差異：混合架構的影響

#### A. Verifying 模式的混合流程

```typescript
// 步驟 1: 通過 API 準備 UserOperation
const prepared = await fetch('/sponsorships/prepare', {
  body: JSON.stringify({ type: 'verifying', ...params }),
});

// 步驟 2: 本地簽名 (跳過 API)
const signed = await localSignUserOperation(prepared.userOp);

// 步驟 3: 直接 SDK 提交 (跳過 API)
const result = await kernelClient.sendUserOperation(signed);
```

**優點**: 測試 API 準備邏輯的正確性  
**缺點**: 未測試完整的 API 工作流 (`POST /sponsorships/submit`)

#### B. ERC20 模式的純 SDK 流程

```typescript
// 一體化：配置 → 執行 → 提交
const kernelClient = await createErc20KernelClient(); // 獨立配置
const userOpHash = await kernelClient.sendUserOperation(callData);
```

**優點**: 測試 SDK 功能的完整性  
**缺點**: 未測試 API 的 ERC20 paymaster 支援

#### C. 目前使用這個方法的原因為：

可以幫我們先確認：

1. /sponsorships/prepare 有沒有準備對

2. userOp 格式對不對
3. local sign 能不能成功
   最後 SDK 能不能送出去
4. eroDev SDK 支不支援 ERC20 paymaster
5. gasToken 設定對不對
6. 整個 sponsor 流程能不能跑通

所以它很適合除錯階段。

但它不適合當最終報告的主流程，因為：

它沒有完整測到 /sponsorships/submit

### 4. 配置管理分析

#### A. 重複配置的風險

```typescript
// zerodev.service.ts (API 使用)
private readonly POLYGON_USDC = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359';

// compare-costs.ts (測試腳本使用)
const ERC20_TOKEN = getAddress('0x3c499c542cef5e3811e1192ce70d8cc03d5c3359');
```

**潛在問題**:

- 兩處維護相同配置，容易不同步
- 測試環境與生產環境可能使用不同的代幣地址

#### B. Gas 參數處理差異

```typescript
// API 路徑 - 支援參數覆蓋
if (params.gasLimit) userOp.callGasLimit = params.gasLimit;
if (params.gasPrice) userOp.maxFeePerGas = params.gasPrice;

// 直接 SDK 路徑 - 使用預設值
const userOp = await kernelClient.prepareUserOperation({ callData });
```

**影響**: ERC20 測試無法驗證 gas 參數覆蓋功能

### 5. API 架構詳解

```
├── src/sponsorships/
│   ├── sponsorships.controller.ts    # HTTP 端點，API Key 驗證
│   ├── sponsorships.service.ts       # 業務邏輯，BigInt 序列化
│   ├── zerodev.service.ts           # ZeroDev SDK 整合，核心邏輯
│   └── dto/
│       ├── prepare.dto.ts           # gasLimit, gasPrice, type 參數
│       └── submit.dto.ts            # signedUserOp 參數
```

### 6. 測試架構詳解

```
├── script/
│   ├── compare-costs.ts             # 主測試腳本
│   │   ├── runUnsponsored()         # 基準測試
│   │   ├── runVerifying()           # API + SDK 混合
│   │   └── runErc20()               # 純 SDK 測試
│   └── test-sponsored-flow.ts       # 功能驗證腳本
├── results.csv                      # 自動生成數據
└── CompareGas.md                   # 人工分析報告
```

---

## 結論

### 已完成功能 ✅

1. **ERC20 轉帳支援**: 完整實作，使用標準 ERC20 ABI
2. **Polygon 網路**: 全面支援 Polygon 網路
3. **Gas 參數支援**: gasLimit 和 gasPrice 完整實作
4. **ERC20 Paymaster**: 支援 verifying 和 erc20 兩種模式
5. **成本比較**: 完整的 USD 成本計算和比較分析

### 技術亮點

- 使用 ZeroDev SDK 提供企業級 Account Abstraction 解決方案
- 支援靈活的 paymaster 配置
- 完整的成本追蹤和分析系統
- 自動化測試和數據收集

### 目標 🚧

- **服務器部署**: 尚未部署至 Render 或其他雲端平台

我希望最終把 sponsorship flow 統一成 API prepare → 前端錢包簽名 → API submit。
這樣的設計可以讓後端負責 gas estimation、paymaster selection 與 on-chain submission，同時保留使用者端自行簽名的安全性，也更接近真實產品的 account abstraction workflow。

### 成本效益分析

- **用戶體驗**: ERC20 paymaster 提供最佳的用戶體驗（無需持有原生代幣）
- **成本考量**: Sponsored 交易成本為原生交易的 6.7-8.5 倍
- **延遲權衡**: Sponsored 交易延遲較高，特別是 ERC20 paymaster
