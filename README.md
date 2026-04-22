# Polygon Gas Sponsorship Platform

A full-stack gas sponsorship platform built to compare and validate different ways users can send blockchain transactions on Polygon **without relying on the traditional “user must always hold native gas token” model**.

This project focuses on three transaction payment models:

* **Unsponsored** — the user pays gas directly in the native token
* **Verifying Paymaster** — the sponsor pays gas on behalf of the user
* **ERC20 Paymaster** — the user pays gas in ERC20 instead of the native token

The platform includes both a **frontend** and a **backend API**, allowing real end-to-end testing of sponsored transaction flows in a way that reflects how real users would interact with the system.

---

## What problem does this product solve?

One of the biggest usability problems in Web3 is gas.

In a traditional blockchain flow, users must:

* own the chain’s native gas token
* understand why gas is needed
* keep enough balance for transactions
* handle failed transactions caused by insufficient gas

This creates a poor onboarding experience, especially for users who only hold stablecoins or app-specific tokens.

This project explores a better model:

* Can a user send transactions **without holding native gas**?
* Can a sponsor cover gas to improve onboarding?
* Can a user pay gas in **USDC** instead of MATIC/POL?
* What are the tradeoffs in **cost** and **time to land** between these models?

This platform exists to answer those questions with real execution data.

---

## What does this product do?

This system provides an end-to-end environment to:

1. **prepare a transaction**
2. **sponsor it through a paymaster**
3. **let the user sign it from the frontend**
4. **submit it to the bundler**
5. **track when it lands on-chain**
6. **measure cost and latency**

In other words, this is not just a script that sends transactions.

It is a **transaction abstraction platform** that simulates how a real application could support different gas-payment experiences for users.

---

## Why compare Unsponsored, Verifying, and ERC20?

These three modes represent three very different product philosophies.

### 1. Unsponsored

In this mode, the user pays gas directly with the native chain token.

This is the traditional blockchain experience.

**What it means**

* simplest infrastructure model
* no sponsor involved
* user must hold native gas token
* user fully bears gas cost

**Why it matters**
This is the baseline.
Without measuring this mode, there is no reference point for comparing sponsored alternatives.

---

### 2. Verifying Paymaster

In this mode, a sponsor pays gas on behalf of the user.

The user signs the transaction, but does not need to spend native gas.

**What it means**

* best onboarding experience
* user can transact without worrying about gas
* sponsor covers the gas cost
* ideal for consumer onboarding, promotions, or enterprise workflows

**Why it matters**
This model is powerful for products that want to remove blockchain friction completely.

But it also raises questions:

* How much does the sponsor actually pay?
* Is the latency different from unsponsored transactions?
* Is the UX improvement worth the sponsor cost?

---

### 3. ERC20 Paymaster

In this mode, the user does not pay gas in native token.
Instead, the user pays in an ERC20 token such as USDC.

**What it means**

* user can transact without holding native gas token
* the system converts the experience into “pay gas in stablecoin”
* closer to mainstream product expectations
* better for users who only hold app assets or stablecoins

**Why it matters**
This is one of the most product-relevant models in account abstraction.

It solves a major UX problem:

> “Why do I need a separate gas token just to use the app?”

At the same time, it adds more complexity:

* approval flow
* paymaster logic
* token accounting
* potentially different latency characteristics

---

## Why is there a frontend?

The frontend is not just for demo purposes.

It exists because this product is designed to validate a very important real-world assumption:

> **Can ordinary EOAs actually use these sponsored flows in practice?**

If everything were only scripted with a private key in the backend, the result would be less realistic.

The frontend proves that:

* a normal wallet user can connect through MetaMask
* a real EOA can derive and use the smart account
* the user can sign the UserOperation from the browser
* the entire flow works from the actual user side, not just from backend automation

This matters a lot, because a product may look correct in a script, but still fail when a real wallet user tries to use it.

So the frontend serves as the **real user validation layer**.

---

## Why is there a backend?

The backend is responsible for the parts that should not live in the client:

* preparing sponsored UserOperations
* calling sponsorship logic
* interacting with the paymaster / bundler flow
* submitting signed UserOperations
* protecting API access with an API key
* providing a stable service endpoint for the frontend and scripts

This makes the architecture closer to how a production application would actually be built.

Instead of exposing all sponsorship logic directly in the frontend, the backend provides a controlled API layer.

---

## Where is the backend deployed?

The backend is deployed publicly on **Render**.

It is currently available as a hosted NestJS web service and exposes routes such as:

* `POST /sponsorships/prepare`
* `POST /sponsorships/submit`

This deployment matters because it allows the project to validate more than just local development:

* local frontend → public backend
* public backend → ZeroDev infrastructure
* real wallet user → real sponsored flow

That makes the system much closer to a real product environment.

---

## Why not do everything in one place?

Because the point of this project is to reflect how real products are built.

### If everything lived only in the frontend:

* sensitive sponsorship logic would be harder to control
* API credentials would be exposed
* it would not reflect production backend architecture

### If everything lived only in the backend:

* you would lose proof that a real EOA wallet can use the system
* signing would no longer reflect true user behavior
* the UX side would not be validated

So the split architecture is intentional:

* **Frontend** = real user interaction and signature flow
* **Backend** = sponsorship orchestration and controlled submission

---

## Product architecture

### Frontend

The frontend is used to:

* connect MetaMask
* derive the smart account sender
* build the transaction callData
* request sponsorship preparation
* sign the prepared UserOperation
* submit the signed result

### Backend

The backend is used to:

* receive prepare requests
* create sponsor-aware UserOperations
* call paymaster logic
* return prepared UserOperations to the client
* receive signed UserOperations
* submit them to the bundler
* return the resulting userOpHash and txHash

### Chain / Infra

The infrastructure layer includes:

* Polygon
* ZeroDev bundler / paymaster infrastructure
* ERC-4337 style UserOperation flow

---

## What makes this project useful?

This project is useful for anyone building:

* wallet onboarding systems
* gasless dApps
* payment abstraction layers
* stablecoin-native Web3 products
* account abstraction products
* sponsored transaction systems

It helps answer practical questions such as:

* Should we sponsor gas for users?
* Should we allow users to pay gas in USDC?
* How much slower is one model than another?
* Who actually pays in each model?
* What product tradeoff do we get from each option?

---

## Benchmark capability

In addition to the interactive frontend flow, the project also includes an automated comparison script that measures:

* transaction cost
* time to land
* user-paid amount
* sponsor-paid amount
* USD-equivalent cost

This allows the system to move beyond “it works” and into:

> “Which sponsorship model is actually better for product use?”

---

## Example use cases

This platform is especially relevant for:

### Consumer apps

A consumer app may want users to sign up and transact without ever buying MATIC/POL first.

### Stablecoin-first products

A payments app may want users to pay fees directly in USDC.

### Enterprise products

An enterprise platform may want the company to sponsor gas and hide blockchain complexity from the end user.

### Web3 onboarding

A new user may not understand gas at all; verifying sponsorship removes that friction entirely.

---

## Why this matters

Most blockchain demos stop at “a transaction was sent.”

This project goes further.

It asks:

* what did the user have to hold?
* who paid?
* how long did it take?
* how realistic is the user flow?
* what tradeoff does the product make?

That is why this project is not just a script or a wallet demo.

It is a **product-oriented gas sponsorship platform** designed to test real account abstraction UX and economics.

---

## Current capabilities

* Supports Polygon
* Supports three sponsorship/payment modes
* Supports real EOA signing through frontend wallet flow
* Supports public backend deployment
* Supports sponsored transaction preparation and submission
* Supports automated benchmarking for cost and latency comparison

---

## Future direction

Potential next steps include:

* multi-chain support
* dashboard analytics
* historical benchmarking
* dynamic price feeds instead of hardcoded USD values
* policy logic for sponsor eligibility
* production admin tooling for sponsorship controls

---

## Summary

This product is built to answer a very practical question for Web3 applications:

> **How should users pay for blockchain transactions, and what does each model cost in UX, time, and money?**

By combining a real frontend wallet flow, a deployed backend API, and measurable on-chain execution, this project provides a realistic environment for evaluating gas sponsorship strategies in modern account abstraction systems.
