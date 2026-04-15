# Sponsorship API Technical Documentation

## Project Overview

Sponsorship API is a NestJS-based service that integrates ZeroDev SDK to implement EIP-7702 Account Abstraction functionality, allowing third parties to sponsor users' gas fees. The system uses a two-phase transaction processing model: preparation and submission phases, ensuring transaction security and control.

## Create a .env as in sponsorship-api/.env

```
API_KEY=my-secret-key
ZERODEV_RPC=
CHAIN_ID=
ENTRYPOINT_VERSION=0.7.0
ZERODEV_BUNDLER_RPC=
NEXT_PUBLIC_ZERODEV_RPC=
RPC_URL=
TEST_PRIVATE_KEY=
```

## System Architecture

```
src/
├── main.ts                 # Application entry point
├── app.module.ts           # Root module
├── app.controller.ts       # Root controller
├── app.service.ts          # Root service
├── common/
│   └── api-key.guard.ts    # API authentication guard
└── sponsorships/
    ├── sponsorships.controller.ts  # Sponsorship transaction controller
    ├── sponsorships.service.ts     # Main business logic
    ├── sponsorships.module.ts      # Sponsorship module
    ├── zerodev.service.ts          # ZeroDev SDK integration
    └── dto/
        ├── prepare.dto.ts          # Prepare request DTO
        └── submit.dto.ts           # Submit request DTO
```

## Core Module Analysis

### 1. Application Core Layer

#### main.ts

```typescript
// Location: src/main.ts
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(3000);
}
```

**Function**: Application entry point, creates NestJS instance and listens on port 3000.

#### app.module.ts

```typescript
// Location: src/app.module.ts:6-11
@Module({
  imports: [SponsorshipsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
```

**Function**: Root module configuration, integrates all sub-modules and registers global services.

### 2. Security Authentication Layer

#### api-key.guard.ts

```typescript
// Location: src/common/api-key.guard.ts:10-24
canActivate(context: ExecutionContext): boolean {
  const request = context.switchToHttp().getRequest();
  const apiKey = request.headers['x-api-key'];

  if (!apiKey) {
    throw new UnauthorizedException('Missing X-API-KEY');
  }

  if (apiKey !== process.env.API_KEY) {
    throw new UnauthorizedException('Invalid API key');
  }

  return true;
}
```

**Functions**:

- Validates `X-API-KEY` in request headers
- Compares with environment variable `API_KEY`
- Ensures API access security

### 3. Sponsorship Transaction Business Layer

#### sponsorships.controller.ts

```typescript
// Location: src/sponsorships/sponsorships.controller.ts:7-21
@Controller('sponsorships')
@UseGuards(ApiKeyGuard)
export class SponsorshipsController {
  @Post('prepare')
  async prepare(@Body() body: PrepareDto) {
    return this.sponsorshipsService.prepare(body);
  }

  @Post('submit')
  async submit(@Body() body: SubmitDto) {
    return this.sponsorshipsService.submit(body);
  }
}
```

**Functions**:

- Provides `/sponsorships/prepare` and `/sponsorships/submit` endpoints
- Applies API Key guard protection
- Handles preparation and submission of sponsored transactions

#### sponsorships.service.ts

**Main Method Analysis**:

1. **serializeBigInt()** - `src/sponsorships/sponsorships.service.ts:10-16`

   ```typescript
   private serializeBigInt(data: any) {
     return JSON.parse(
       JSON.stringify(data, (_, value) =>
         typeof value === 'bigint' ? value.toString() : value,
       ),
     );
   }
   ```

   **Function**: Converts BigInt types to strings, solving JSON serialization issues.

2. **prepare()** - `src/sponsorships/sponsorships.service.ts:18-26`

   ```typescript
   async prepare(body: PrepareDto) {
     const prepared = await this.zeroDevService.prepareUserOp(body);
     return this.serializeBigInt({
       message: 'prepare endpoint works',
       input: body,
       unsignedUserOp: prepared,
     });
   }
   ```

   **Functions**:
   - Receives transaction parameters
   - Calls ZeroDev service to prepare UserOperation
   - Returns unsigned UserOperation

3. **submit()** - `src/sponsorships/sponsorships.service.ts:28-30`
   ```typescript
   async submit(body: SubmitDto) {
     return this.zeroDevService.submitUserOp(body.signedUserOp);
   }
   ```
   **Functions**:
   - Receives signed UserOperation
   - Submits to blockchain network

### 4. ZeroDev SDK Integration Layer

#### zerodev.service.ts

This is the core service responsible for ZeroDev SDK integration.

**Environment Variable Configuration**:

```typescript
// Location: src/sponsorships/zerodev.service.ts:21-36
private readonly ZERODEV_RPC = process.env.ZERODEV_RPC as string;
private readonly RPC_URL = process.env.RPC_URL as string;
private readonly PRIVATE_KEY = process.env.TEST_PRIVATE_KEY as Hex;
```

**Core Method Analysis**:

1. **create7702Client()** - `src/sponsorships/zerodev.service.ts:142-187`

   ```typescript
   async create7702Client(useSponsorGas: boolean = false) {
     // Create EIP-7702 kernel account
     const kernelAccount = await createKernelAccount(publicClient, {
       entryPoint,
       kernelVersion: constants.KERNEL_V3_3,
       eip7702Account: account,
     });

     // Configure paymaster for gas sponsorship
     if (useSponsorGas) {
       clientConfig.paymaster = {
         getPaymasterData: async (userOperation: any) => {
           return paymasterClient.sponsorUserOperation({ userOperation });
         },
       };
     }
   }
   ```

   **Functions**:
   - Creates EIP-7702 compatible Kernel account
   - Configures paymaster for gas sponsorship
   - Returns fully configured kernel client

2. **prepareUserOp()** - `src/sponsorships/zerodev.service.ts:189-227`

   ```typescript
   async prepareUserOp(params: {
     from: string;
     to?: string;
     data?: `0x${string}`;
     value?: string;
     nonce?: number;
   }) {
     const { kernelClient, account, kernelAccount } = await this.create7702Client(true);

     const callData = await (kernelClient.account as any).encodeCalls([{
       to: params.to as `0x${string}`,
       value: BigInt(params.value ?? '0'),
       data: (params.data ?? '0x') as `0x${string}`,
     }]);

     const userOp = await (kernelClient as any).prepareUserOperation({ callData });
   }
   ```

   **Functions**:
   - Encodes transaction parameters to callData
   - Prepares UserOperation structure
   - Automatically calculates gas fees and paymaster data

3. **submitUserOp()** - `src/sponsorships/zerodev.service.ts:228-282`

   ```typescript
   async submitUserOp(signedUserOp: Record<string, any>) {
     const userOpHash = await this.rpc('eth_sendUserOperation', [
       {
         sender: signedUserOp.sender,
         nonce: this.toHex(signedUserOp.nonce),
         // ... other parameters
       },
       entryPoint.address,
     ]);

     const receipt = await this.waitForUserOperationReceipt(userOpHash);
   }
   ```

   **Functions**:
   - Submits signed UserOperation to bundler
   - Waits for transaction receipt
   - Returns userOpHash and txHash

4. **waitForUserOperationReceipt()** - `src/sponsorships/zerodev.service.ts:38-59`

   ```typescript
   private async waitForUserOperationReceipt(userOpHash: string) {
     const maxAttempts = 30;
     const delayMs = 2000;

     for (let i = 0; i < maxAttempts; i += 1) {
       try {
         const result = await this.rpc('eth_getUserOperationReceipt', [userOpHash]);
         if (result) return result;
       } catch {
         // ignore errors and retry
       }
       await new Promise((resolve) => setTimeout(resolve, delayMs));
     }
   }
   ```

   **Functions**:
   - Polls for UserOperation confirmation
   - Maximum 30 attempts with 2-second intervals
   - Throws exception on timeout

## Complete Business Flow

### 1. Prepare Phase

**Code Mapping**:

1. `src/sponsorships/sponsorships.controller.ts:12-15` - Receive prepare request
2. `src/sponsorships/sponsorships.service.ts:18-26` - Handle preparation logic
3. `src/sponsorships/zerodev.service.ts:189-227` - Prepare UserOperation

**Flow**:

```
test-sponsored-flow.ts
   ↓ call /prepare
SponsorshipsController
   ↓
SponsorshipsService
   ↓
ZeroDevService.prepareUserOp()
   ↓
return prepared userOp
   ↑
test-sponsored-flow.ts take userOp
   ↓ signUserOperation()
test-sponsored-flow.ts signing
   ↓ call /submit
SponsorshipsController
   ↓
SponsorshipsService
   ↓
ZeroDevService.submitUserOp()
   ↓
bundler / chain
   ↓
return userOpHash / txHash
```

### 2. Signing Phase

This phase is performed on the client side, using private keys to sign the UserOperation.

**Test Script Implementation** - `script/test-sponsored-flow.ts:146-182`:

```typescript
async function signUserOperation(userOp: Record<string, any>) {
  const { kernelClient } = await createSigningKernelClient();
  const realSignature = await (kernelClient.account as any).signUserOperation({
    // UserOperation parameters
    signature: '0x',
  });
  signedUserOp.signature = realSignature;
  return signedUserOp;
}
```

### 3. Submit Phase

**Code Mapping**:

1. `src/sponsorships/sponsorships.controller.ts:17-20` - Receive submit request
2. `src/sponsorships/sponsorships.service.ts:28-30` - Handle submission logic
3. `src/sponsorships/zerodev.service.ts:228-282` - Submit to blockchain

## Data Transfer Objects (DTO)

### PrepareDto

```typescript
// Location: src/sponsorships/dto/prepare.dto.ts
export class PrepareDto {
  from!: string; // Sender address
  to?: string; // Target address
  data?: `0x${string}`; // Transaction data
  value?: string; // Transfer amount
  nonce?: number; // Transaction nonce
}
```

### SubmitDto

```typescript
// Location: src/sponsorships/dto/submit.dto.ts
export class SubmitDto {
  @IsObject()
  @IsNotEmpty()
  signedUserOp!: {
    sender: string;
    nonce: string;
    callData: string;
    signature: string;
    // gas-related parameters
    // paymaster-related parameters
  };
}
```

## API Usage Guide

### Environment Setup

Create `.env` file:

```env
API_KEY=your-secret-api-key
ZERODEV_RPC=https://rpc.zerodev.app/api/v2/bundler/YOUR_PROJECT_ID
RPC_URL=https://sepolia.infura.io/v3/YOUR_INFURA_KEY
TEST_PRIVATE_KEY=0x...
```

### 1. Prepare Transaction

**Request**:

```bash
yong@chenpinyangdeMacBook-Air sponsorship-api % curl -X POST http://localhost:3000/sponsorships/prepare \
  -H "Content-Type: application/json" \
  -H "X-API-KEY: my-secret-key" \
  -d '{
    "from": "0x1111111111111111111111111111111111111111",
    "to": "0x2222222222222222222222222222222222222222",
    "data": "0x",
    "value": "0"
  }'
```

**Response**:

```json
{
  "message": "prepare endpoint works",
  "input": {
    "from": "0x1111111111111111111111111111111111111111",
    "to": "0x2222222222222222222222222222222222222222",
    "data": "0x",
    "value": "0"
  },
  "unsignedUserOp": {
    "stage": "prepared",
    "sponsorEnabled": true,
    "requestedFrom": "0x1111111111111111111111111111111111111111",
    "actualSignerAddress": "0xA61Dd89a50CA4Cc3FD1ECe44cA666B138a2900AB",
    "kernelAccountAddress": "0xA61Dd89a50CA4Cc3FD1ECe44cA666B138a2900AB",
    "call": {
      "to": "0x2222222222222222222222222222222222222222",
      "data": "0x",
      "value": "0"
    },
    "userOp": {
      "callData": "0xe9ae5c5300000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000003422222222222222222222222222222222222222220000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
      "paymaster": "0x777777777777AeC03fd955926DbF81597e66834C",
      "sender": "0xA61Dd89a50CA4Cc3FD1ECe44cA666B138a2900AB",
      "maxFeePerGas": "710252209",
      "maxPriorityFeePerGas": "156620534",
      "nonce": "5",
      "signature": "0xfffffffffffffffffffffffffffffff0000000000000000000000000000000007aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1c",
      "callGasLimit": "17955",
      "verificationGasLimit": "41810",
      "preVerificationGas": "50508",
      "paymasterVerificationGasLimit": "35470",
      "paymasterPostOpGasLimit": "1",
      "paymasterData": "0x01000069d57736000000000000087502c257a4f4369c4cf18806b637e62cf6ce8b80e2687d099e81c7e81a2f1e017ef28bedbd6ea9948a062ddd8f1b02a3f8a5111cf950fe903c7c7205dc99761c"
    },
    "note": "ZeroDev handled gas + paymaster automatically via kernelClient."
  }
}
```

### 2. Submit Signed Transaction

**Request**:

```bash
curl -X POST http://localhost:3000/sponsorships/submit \
  -H "Content-Type: application/json" \
  -H "X-API-KEY: your-secret-api-key" \
  -d '{
    "signedUserOp": {
      "sender": "0xefgh...",
      "nonce": "0x0",
      "callData": "0x...",
      "signature": "0x...",
      // ... complete UserOperation parameters
    }
  }'
```

**Response**:

```json
{
  "userOpHash": "0x1a2b3c...",
  "txHash": "0x4d5e6f..."
}
```

## Test Script Usage

### Execute End-to-End Test

```bash
# Install dependencies
npm install

# Setup environment variables
cp .env.example .env
# Edit .env file

# Start API service
npm run start:dev

# Execute test script in another terminal
npx tsx script/test-sponsored-flow.ts
```

### Test Script Output Analysis

**Successful execution output example**:

```
yong@chenpinyangdeMacBook-Air script % npx tsx test-sponsored-flow.ts
◇ injected env (8) from ../.env // tip: ⌘ override existing { override: true }

=== Step 1: call /prepare ===

[prepare result]
{
  message: 'prepare endpoint works',
  input: {
    from: '0xA61Dd89a50CA4Cc3FD1ECe44cA666B138a2900AB',
    to: '0x2222222222222222222222222222222222222222',
    data: '0x',
    value: '0'
  },
  unsignedUserOp: {
    stage: 'prepared',
    sponsorEnabled: true,
    requestedFrom: '0xA61Dd89a50CA4Cc3FD1ECe44cA666B138a2900AB',
    actualSignerAddress: '0xA61Dd89a50CA4Cc3FD1ECe44cA666B138a2900AB',
    kernelAccountAddress: '0xA61Dd89a50CA4Cc3FD1ECe44cA666B138a2900AB',
    call: {
      to: '0x2222222222222222222222222222222222222222',
      data: '0x',
      value: '0'
    },
    userOp: {
      callData: '0xe9ae5c5300000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000003422222222222222222222222222222222222222220000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      paymaster: '0x777777777777AeC03fd955926DbF81597e66834C',
      sender: '0xA61Dd89a50CA4Cc3FD1ECe44cA666B138a2900AB',
      maxFeePerGas: '1839349389',
      maxPriorityFeePerGas: '1157720',
      nonce: '4',
      signature: '0xfffffffffffffffffffffffffffffff0000000000000000000000000000000007aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1c',
      callGasLimit: '17955',
      verificationGasLimit: '41810',
      preVerificationGas: '50508',
      paymasterVerificationGasLimit: '35470',
      paymasterPostOpGasLimit: '1',
      paymasterData: '0x01000069d42bbb0000000000007b8de84e6af7219428873fdecd9d1c84be2415f6aff8e0c052696492e27959683f8fdd979f578212c20043d20d6216ce7b73166b674690560712767a809e4c6f1b'
    },
    note: 'ZeroDev handled gas + paymaster automatically via kernelClient.'
  }
}

=== Step 2: sign userOp ===


[debug] signing userOp...

[debug] sender: 0xA61Dd89a50CA4Cc3FD1ECe44cA666B138a2900AB
[debug] nonce: 4
[signed userOp]
{
  callData: '0xe9ae5c5300000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000003422222222222222222222222222222222222222220000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
  paymaster: '0x777777777777AeC03fd955926DbF81597e66834C',
  sender: '0xA61Dd89a50CA4Cc3FD1ECe44cA666B138a2900AB',
  maxFeePerGas: '1839349389',
  maxPriorityFeePerGas: '1157720',
  nonce: '4',
  signature: '0x46db6680dc16573abd5bf517e288162169391be7b2c65d41e9ba8049b0cdb02f2bdf7a9a06e0759d1481f2f17dc4490d3e027ab522ff7bb7855953bb60c530421b',
  callGasLimit: '17955',
  verificationGasLimit: '41810',
  preVerificationGas: '50508',
  paymasterVerificationGasLimit: '35470',
  paymasterPostOpGasLimit: '1',
  paymasterData: '0x01000069d42bbb0000000000007b8de84e6af7219428873fdecd9d1c84be2415f6aff8e0c052696492e27959683f8fdd979f578212c20043d20d6216ce7b73166b674690560712767a809e4c6f1b'
}

=== Step 3: call /submit ===

[submit result]
{
  userOpHash: '0xc306ee21c401560faa1796c7e263c1400ff6ea5080d63644e8183b63d49737e5',
  txHash: '0x42da883a72b4f79eb1f02851b53b10c8faff75d92f0eecbf14f7ac410ce8ed19'
}

[final] submit success
userOpHash: 0xc306ee21c401560faa1796c7e263c1400ff6ea5080d63644e8183b63d49737e5
txHash: 0x42da883a72b4f79eb1f02851b53b10c8faff75d92f0eecbf14f7ac410ce8ed19
```

## Error Handling

### Common Error Types

1. **Authentication Error**:

   ```json
   {
     "statusCode": 401,
     "message": "Missing X-API-KEY"
   }
   ```

2. **Missing Environment Variables**:

   ```
   Error: Missing ZERODEV_RPC in .env
   ```

3. **UserOperation Submission Failure**:
   ```json
   {
     "userOpHash": null,
     "txHash": null,
     "error": "RPC eth_sendUserOperation failed: insufficient funds"
   }
   ```

## Technical Features

### 1. Security

- API Key authentication mechanism
- Private key environment variable protection
- UserOperation signature verification

### 2. Scalability

- Modular architecture design
- NestJS dependency injection
- TypeScript type safety

### 3. Reliability

- Transaction receipt polling confirmation
- Error handling and retry mechanisms
- BigInt serialization support

### 4. Sponsorship Mechanism

- Automatic gas fee estimation
- Paymaster integration
- EIP-7702 Account Abstraction

## Deployment Recommendations

### Development Environment

```bash
npm run start:dev  # Watch mode
```

### Production Environment

```bash
npm run build
npm run start:prod
```

## Summary

Sponsorship API provides a complete sponsored transaction solution, implementing EIP-7702 Account Abstraction through ZeroDev SDK, allowing users to enjoy gas-free blockchain interactions. The system design considers security, scalability, and reliability, making it suitable as infrastructure services for Web3 applications.

## Core knowledge

1. **What is the main purpose of the `/sponsorships/prepare` endpoint?**

The purpose of `/prepare` is to convert a regular transaction into an ERC-4337 UserOperation, and pre-fill fields such as gas, paymaster, and callData, making it a structure that can be processed by the bundler and paymaster, but not yet signed.

---

2. **Why is the `userOp.signature` returned by prepare a placeholder (fake)?**

The signature is a placeholder because the backend does not have access to the user's private key. The actual signature must be produced by the user’s wallet.

---

3. **What is the relationship between `/submit` and `/prepare`?**

`prepare` creates an unsigned UserOperation, while `submit` sends the signed UserOperation to the bundler for on-chain execution.

---

4. **What is the difference between `userOpHash` and `txHash`?**

- `userOpHash`: an identifier at the bundler level
- `txHash`: the actual transaction hash after being included on-chain

So, `userOpHash` exists before on-chain inclusion, while `txHash` only exists after execution.

---

5. **What is the difference between `signUserOperation` and `sign7702Authorization`?**

`signUserOperation` signs a specific transaction, while `sign7702Authorization` authorizes the account to act as a smart account under EIP-7702.

---

6. **Why does the system still work even though you are not using `sign7702Authorization`?**

Because the ZeroDev SDK automatically generates and injects the 7702 authorization, the system can still function correctly without manually calling `sign7702Authorization`.

---

7. **What role does the paymaster play in this project?**

The paymaster is a smart contract that pays gas fees for the UserOperation, allowing users to complete transactions without holding ETH.

---

8. **Why can’t we directly send the transaction in `/prepare`, and instead need separate prepare + submit steps?**

Because signing must be done by the user, and the backend cannot hold private keys, transaction preparation and submission must be separated.

---

9. **Overall flow: prepare → sign → submit → wait**

| Step    | Responsible Party               |
| ------- | ------------------------------- |
| prepare | backend                         |
| sign    | user wallet (MetaMask / signer) |
| submit  | backend (calls bundler RPC)     |
| wait    | backend (polls bundler)         |

---

10. **If the following error occurs:**

**AA24 signature error**

The most likely issue is in the signing step.

This usually happens when the signature does not match the sender or the expected validation logic, such as:

- incorrect signer
- wrong nonce
- mismatched userOpHash
