
---

# ZeroDev's EIP-7702 MVP Experiment Summary

## 1. Objective (Why)

The goal of this experiment is not to build a full product, but to validate a core question:

**Can a standard EOA (Externally Owned Account) temporarily gain smart account capabilities via EIP-7702, and successfully execute transactions under gas sponsorship?**

---

## 2. High-Level Flow

The overall flow is as follows:

```
User signs EIP-7702 authorization
        ↓
Smart Account (Kernel) constructs the operation
        ↓
Bundler (ZeroDev) submits the UserOperation
        ↓
Paymaster (optional gas sponsorship)
        ↓
EntryPoint executes the transaction
```

---

## 3. System Architecture

```
[User Wallet]
(MetaMask / Turnkey / Local EOA)

        ↓ Signature (EIP-7702 authorization)

[Smart Account Layer]
(EIP-7702 + Kernel Account)

        ↓

[Bundler]
(ZeroDev)

        ↓

[Paymaster]
(ZeroDev / future ERC20)

        ↓

[Blockchain]
```

---

## 4. Current Implementation Scope

It is important to clarify:

This MVP does **not** use MetaMask to directly perform the EIP-7702 flow.

Instead:

* MetaMask is used only to select a recipient address
* The actual EIP-7702 flow is executed using a local private key from `.env.local`

---

## 5. Core File: `zerodev.ts`

This file contains the core implementation of the EIP-7702 flow.

It performs the following steps:

1. Load local private key
2. Create a local EOA account
3. Sign EIP-7702 authorization
4. Create a Kernel smart account
5. Construct a UserOperation
6. Optionally attach a Paymaster
7. Send the operation to the Bundler

---

## 6. Key Components

### getPublicClient()

A read-only client.

Capabilities:

* Fetch nonce
* Fetch transaction receipts
* Estimate gas
* Query on-chain data

Limitations:

* Cannot sign transactions

---

### getLocalAccount()

Converts the private key in `.env.local` into a usable blockchain account.

Includes:

* Address
* Message signing capability
* Transaction signing capability

---

### getLocalWalletClient()

A client capable of:

* Signing
* Sending transactions

---

### sign7702Authorization()

This function allows the EOA to sign an authorization message:

> "I authorize a delegation contract to act on my behalf using smart account logic."

This is the core of EIP-7702.

---

### create7702Client()

Combines:

* EOA
* EIP-7702 authorization
* Kernel account

Result:
A smart account client capable of sending UserOperations.

---

### EntryPoint 

The core contract in the ERC-4337 architecture.

It acts as:

**The central entry point for all UserOperations**

Responsibilities include:

* Validation
* Execution
* Gas management
* Paymaster handling

---

## 7. Relationship Between EIP-7702 and ERC-4337

### EIP-7702 solves:

**Whether an EOA can temporarily behave like a smart account**

---

### ERC-4337 solves:

**How operations are validated, bundled, paid for, and executed**

---

### Conclusion:

Both can be used together:

* EIP-7702 → Provides account capability
* ERC-4337 → Provides execution infrastructure

---

## 8. Gas Sponsorship

```ts
if (useSponsorGas) {
  clientConfig.paymaster = createZeroDevPaymasterClient({
    transport: http(ZERODEV_RPC),
  })
}
```

This enables gas sponsorship via a Paymaster.

---

### Two scenarios:

#### Sponsored flow

* Paymaster covers gas fees
* Transaction succeeds

#### Basic flow (no sponsorship)

* Smart account has no funds
* Simulation fails with: `AA21: didn't pay prefund`

---

## 9. What Happens When the Button Is Clicked

1. The local EOA signs an EIP-7702 authorization
2. A delegated smart account (Kernel) is created
3. A UserOperation is constructed
4. The operation is sent to the ZeroDev bundler
5. If a Paymaster is attached → gas is sponsored → transaction succeeds
6. Otherwise → insufficient prefund → transaction fails

---

## 10.(question from last week) Why Not Use Turnkey Gas Station?

### Turnkey Model (Non-4337)

```
User intent (EIP-712)
        ↓
Backend / relayer
        ↓
Turnkey sponsor wallet
        ↓
Direct transaction submission
```

---

### Characteristics:

* No bundler
* No EntryPoint
* Not based on ERC-4337
* Sponsor is a standard wallet

### Difference

1. 7702 only

Solves:

“Can an EOA behave like a smart account?”

2. 7702 + ERC-4337

Solves:

“Can the entire transaction lifecycle be abstracted?”

Including:

Who pays for gas
Who submits the transaction
How validation is handled
How batching is performed
How gas sponsorship is implemented

---

### Problem It Solves:

**Abstracts gas complexity for Web2 users**

---

### Why It Does Not Fit This Research:

This project requires:

* Support for any EOA (e.g., MetaMask)
* Standard ERC-7702 architecture
* Extensibility to ERC20-based gas payment

---

## 11. Future Architecture

```
[User Wallet]
(MetaMask / Turnkey)

        ↓

[EIP-7702 Smart Account]
(Kernel)

        ↓

[Bundler]
(ZeroDev)

        ↓

[Paymaster]
(ERC20 / Sponsor)

        ↓

[Blockchain]
```

---

## 12. Next Steps (Roadmap)

### 1. ERC20 Gas Payment

Transition from:

* Full sponsorship

To:

* Gas paid using ERC20 tokens

---

### 2. Turnkey Integration

Use Turnkey for:

* Wallet management
* Embedded wallets
* Signing

While still:

* Supporting user-owned EOAs

---

### 3. Policy Controls

Implement constraints in Turnkey:

* Allowed contracts
* Allowed function selectors
* Maximum transaction amounts

This enables **secure gas sponsorship policies**

---

## Conclusion

This MVP successfully validates that:

**An EOA can be transformed into a smart account via EIP-7702 and execute transactions through ZeroDev with paymaster-sponsored gas.**
