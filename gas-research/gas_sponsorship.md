# EVM gas sponsorship

## 1. Look into Turnkey 7702 implementation and compare to the alternatives.

Turnkey’s EIP-7702 implementation has two paths.

The first path is to use Turnkey as the wallet infrastructure / signer, and then connect it to an external AA (account abstraction) provider. The official Turnkey documentation directly includes integration examples with ZeroDev and Biconomy (Modular Execution Environment).

The second path is to directly use Turnkey’s own native Transaction Management / Gas Sponsorship, or go one step further and use the Gas Station SDK to build an EIP-7702 delegation + EIP-712 intent-based gasless flow. In this flow, the user signs an intent with EIP-712 saying “I want to do this,” and then uses EIP-7702 authorization to let an authorized smart contract execute the transaction and pay gas on the user’s behalf.

The Gas Station SDK explicitly requires the sponsor-side paymaster wallet to be managed by Turnkey, while the user wallet can either be a Turnkey wallet or an external wallet. Although Turnkey itself can help you send transactions, work with a relayer, and achieve a “the user does not need to pay gas” experience, Turnkey does not provide a standard ERC-4337 paymaster or a bundler. In other words, **Turnkey ≠ an AA (Account Abstraction) stack**. 

---

## Comparison table

| Dimension               | Turnkey Native                                  | ZeroDev                                | Biconomy                                             |
| ----------------------- | ----------------------------------------------- | -------------------------------------- | ---------------------------------------------------- |
| Architecture type       | Single provider (Turnkey-led)                   | Layered (custody + AA)                 | Layered (custody + orchestration)                    |
| Division of roles       | Turnkey handles signer + sponsorship end-to-end | Turnkey (wallet) + ZeroDev (AA)        | Turnkey (wallet) + Biconomy (execution)              |
| AA support              | ❌ Not full AA (no standard paymaster / bundler) | ✅ Full AA (4337 + 7702)                | ⚠ Beyond AA (MEE abstraction)                        |
| Paymaster model         | ❌ Non-standard (managed sponsor)                | ✅ verifying + ERC20 paymaster          | ⚠ Abstracted by MEE (does not emphasize “paymaster”) |
| ERC20 gas               | ❌ Must build it yourself                        | ✅ USDC (officially supported)          | ✅ Any ERC20 (official claim)                         |
| Bundler                 | ❌ None (you handle it yourself)                 | ✅ Yes (provided by ZeroDev)            | ⚠ Abstracted away (handled inside MEE)               |
| 7702 support method     | Gas Station + relayer                           | AA flow (standardized)                 | MEE sponsorship flow                                 |
| Compatible with EOA     | ✅                                               | ✅                                      | ✅                                                    |
| Modular                 | ⚠ Medium (partially tied to Turnkey)            | ✅ High (AA / paymaster can be swapped) | ⚠ Medium (leans more toward the Biconomy stack)      |
| Multi-chain             | ⚠ Basic EVM                                     | ✅ Multi-chain AA                       | ✅ 🔥 Multi-chain orchestration (gas tank)            |
| Cost transparency       | ❌ Low (requires enterprise discussion)          | ✅ High (subscription + 5% spread)      | ❌ Low (requires discussion)                          |
| Complexity              | ⭐ ⭐ (simple)                                    | ⭐ ⭐ ⭐ (medium)                         | ⭐ ⭐ ⭐ ⭐ (high)                                       |
| Debug / observability   | ❌ Low (black box)                               | ✅ High (AA flow is observable)         | ⚠ Medium (abstracted away)                           |
| Suitable for research   | ❌ Not suitable                                  | ✅ Most suitable                        | ⚠ Not ideal for precise comparison                   |
| Suitable for production | ⚠ Possible, but limited                         | ✅ Very good                            | ✅ 🔥 Very strong, but complex                        |



---

## Flow diagrams

**Turnkey:**
User → Turnkey (sponsor here) → Blockchain

**Turnkey + ZeroDev:**
User
↓
Smart Account
↓
Paymaster (sponsor here)
↓
Bundler
↓
Blockchain

**Turnkey + Biconomy:**
User
↓
MEE
↓
Gas Tank (sponsor)
↓
Execution Engine
↓
Blockchain



---

Compared with the other options, Turnkey is more like **secure signing and wallet infrastructure**, rather than the most typical “bundler + paymaster + smart account all-in-one package.” ZeroDev, by contrast, is more clearly positioned as a smart account / account abstraction solution. It supports both ERC-4337 and EIP-7702, and places sponsor gas, ERC20 gas payment, and batching within the same product suite. Biconomy, on the other hand, places gas sponsorship inside MEE, a higher-level execution / orchestration model. It supports EIP-7702, native smart contract accounts, and a Fusion flow starting from a normal EOA. 

---

# 2.2 Evaluate options based on:

## 2.2.1 What kind of paymasters are supported? Eg verifying paymaster, ERC20 paymaster.

### Turnkey

Turnkey should be viewed in two modes.

If you use native Transaction Management / Gas Sponsorship, it is more like a managed sponsorship service provided by Turnkey itself. The emphasis in the documentation is that “Turnkey sponsors for you,” rather than packaging itself as a standard ERC-4337 verifying paymaster or ERC20 paymaster.

If you use the Gas Station SDK, Turnkey states this very directly: it is using “your own paymaster” to perform EIP-7702 gasless transactions. Therefore, it is closer to a custom paymaster flow, rather than an official, standardized verifying paymaster or ERC20 paymaster product. 

### ZeroDev

ZeroDev clearly supports two types:

1. sponsor gas
2. ERC20 gas payment

Its official ERC20 gas payment documentation currently directly lists a **USDC paymaster**, and it publicly states that when users pay gas with ERC20, ZeroDev adds a **5% profit margin** to the exchange rate. Among these providers, its paymaster model is the clearest. 

### Biconomy

Biconomy’s current official narrative is no longer centered around the traditional “paymaster,” but around **MEE sponsorship**. It explicitly states that MEE supports **all ERC-20s, multichain execution, and full transaction abstraction**. It also supports EIP-7702 sponsorship, native SCAs, and Fusion. In other words, it can deliver the same type of experience as verifying paymasters / ERC20 gas payment, but its official language has moved toward a higher-level abstraction and no longer uses the term “paymaster” as the main framing. 

### Pimlico

Pimlico’s official positioning is not that of a full account abstraction platform, but rather one focused on providing **underlying AA infrastructure**. It mainly provides standardized ERC-4337 components, including bundlers and paymasters, such as verifying paymasters and ERC20 paymasters. Pimlico clearly supports AA operations across multiple EVM chains and allows developers to directly connect to its bundler and paymaster through RPC services. 

Unlike ZeroDev or Biconomy, Pimlico does not provide smart account abstraction, a wallet SDK, or higher-level transaction orchestration. Instead, it leaves those responsibilities to the developer or to other upper-layer services. In other words, it focuses on providing AA capabilities closest to the protocol level, rather than further packaging them into a complete development platform or execution layer. 

Therefore, although Pimlico can also support standard AA functions such as verifying paymasters and ERC20 gas payment, its design philosophy is more about **providing raw components** rather than **providing a complete solution**. This gives Pimlico greater flexibility and control, but at the same time requires higher integration cost and more engineering investment. It is also worth noting that there are no ready-made Turnkey integration examples in the Turnkey documentation that can be studied. 

---

## 2.2.2 Enumerate the specific infrastructure each solution provides. Eg wallets, smart accounts, paymasters, bundlers? What parts are modular such that we can bring our own components, and which parts are required when using their 7702 implementation

### Answer

### Turnkey

The core things Turnkey provides are:

* wallet infrastructure
* key management / signer
* policies
* transaction management
* gas sponsorship / gas station flow

It is not primarily focused on providing a full “bundler + smart account + paymaster” package.

There are two paths for using Turnkey with 7702:

1. Use Turnkey as the signer, and connect ZeroDev / Biconomy yourself.
2. Use Turnkey Gas Station / native sponsorship, with Turnkey handling the sponsor side.

In terms of modularity, Turnkey is open on the user wallet side because the Gas Station SDK allows external wallets. However, the sponsor-side paymaster wallet must be Turnkey-managed. 

### ZeroDev

ZeroDev provides:

* smart accounts
* sponsor gas
* ERC20 gas payment
* transaction abstraction
* key abstraction
* bundler / paymaster-type service capabilities

Among the four, it is the one with the most concentrated AA components. If you go with 7702, what ZeroDev needs is an EOA / signer capable of doing 7702 delegation, but it does not require you to use ZeroDev’s own wallet infrastructure. It can also work with external login components such as passkeys and social login. 

### Biconomy

Biconomy provides:

* MEE execution layer
* sponsorship
* multichain gas tank
* EIP-7702 flow
* native SCA flow
* Fusion flow (also usable by a normal EOA)
* self-hosted sponsorship option

Its degree of modularity is not low, because it even supports self-hosted sponsorship. In other words, you can use Biconomy in a hosted mode, or you can control the sponsor backend yourself. 

---

## 2.2.2.1 Do you have to use the provider’s wallet infrastructure in order to use their 7702? Eg is their 7702 compatible with a regular EOA?

### Answer

* **Turnkey:** No. The Gas Station SDK explicitly states that the user wallet can be Turnkey-managed or an external wallet; only the sponsor-side paymaster wallet should be managed by Turnkey. This means it is compatible with a regular EOA.
* **ZeroDev:** In principle, no. ZeroDev’s 7702 approach upgrades an EOA into a dual-account / smart-account-like flow. The key point is 7702 delegation, not forcing developers to use a ZeroDev wallet.
* **Biconomy:** No. The official docs directly state that EIP-7702 can be used with embedded wallets, and Fusion can start from an EOA such as MetaMask. Therefore, it is not tied only to its own wallet stack. 

---

## 2.2.3 Supported chains. In case of ERC20 paymaster, also supported tokens.

### Question

Supported chains. In case of ERC20 paymaster, also supported tokens.

### Answer

### Turnkey

Turnkey’s native gas sponsorship / transaction management is currently publicly focused on **Ethereum, Polygon, and Base**, and it also mentions corresponding testnets. In addition, the Gas Station SDK page says that native Transaction Management already supports out-of-the-box sponsorship for both **EVM and Solana**. If we focus only on EVM gas sponsorship for this question, Turnkey can first be listed as mainly supporting **Ethereum / Polygon / Base**. 

### ZeroDev

The chains publicly listed by ZeroDev for ERC20 gas payment are:

* Ethereum
* Polygon
* Base
* Optimism
* Arbitrum

The ERC20 paymaster token directly named in the docs is **USDC**. 

### Biconomy

In its sponsorship docs, Biconomy explicitly says **one gas tank, many chains**, and its 7702 sponsorship page directly says **supports all ERC-20s, multichain execution**. However, I have not yet seen a clean official matrix listing each EVM chain together with every supported token one by one. Therefore, the most conservative conclusion here is:

* chains: multichain
* token: officially claims support for all ERC-20s

But it lacks a more detailed per-chain official table. 

---

## 2.2.4 Solution complexity.

### Question

Solution complexity.

### Answer

If we rate this on a scale from 1 to 5, where a higher score means the integration is more complex, I would rate them as follows:

* **Turnkey native sponsorship: 1.5 / 5**
  Because it is the closest to a managed solution and the fastest to integrate. You can directly use native Transaction Management or the sponsor flow.

* **Turnkey Gas Station SDK: 2.5 / 5**
  Slightly more complex than native, because you need to understand EIP-7702 delegation, EIP-712 intents, Turnkey-managed paymaster wallets, and policies.

* **ZeroDev: 3 / 5**
  Because its functionality is complete, but so is its conceptual scope: you need to understand smart accounts, gas sponsorship, ERC20 gas, and policies. The benefit is that everything is placed within one unified product language, which works very well for AA projects.

* **Biconomy: 4 / 5**
  Because it includes MEE, 7702 sponsorship, native SCAs, Fusion, and hosted / self-hosted sponsorship. There is one extra layer of orchestration concept, making it the most powerful, but also the heaviest. 

---

## 2.2.5 Cost. Breakdown as much as possible. Eg margin on fees paid vs bundler costs.

### Question

Cost. Breakdown as much as possible. Eg margin on fees paid vs bundler costs.

### Answer

For this question, I can only fill it in to the extent that can currently be confirmed from official public information. I should not pretend that all vendors have disclosed their cost breakdowns to the same level of detail.

### Turnkey

Turnkey’s pricing is one of the clearest among the providers:

* **Free:** 25 free transactions / month
* **Pay-as-you-go:** $0.10 / signature
* **Pro:** $99 / month, as low as $0.01 / signature
* **Enterprise:** as low as $0.0015 / signature, and Gas Sponsorship is listed as an Enterprise feature

However, Turnkey does not publicly break gas sponsorship down into three separate lines such as **bundler cost + paymaster margin + gas spread**. Therefore, what can be confirmed is:

1. You will pay Turnkey’s platform / signature cost.
2. Gas sponsorship is an enterprise-plan feature.
3. More detailed sponsorship margin information requires a sales / enterprise discussion. 

### ZeroDev

ZeroDev’s public pricing is also relatively clear:

* **Developer:** $0 / month, including bundler and gas sponsorship access
* **Growth:** $69 / month, including 100,000 credits and $250 gas sponsorship
* **Scale:** $399 / month, including 1,000,000 credits and $1,000 gas sponsorship

In addition, ZeroDev publicly discloses one key detail:
when users pay gas with ERC20, ZeroDev adds a **5% profit margin** to the exchange rate. This is the closest explicit public information to “margin on fees paid” among the providers discussed here. 

### Biconomy

I have not found a fully public official pricing page from Biconomy that can be directly cited and that clearly breaks MEE sponsorship into hosted fee rate, execution fee, gas spread, and token conversion spread. What the official docs do confirm is:

* sponsorship can be hosted or self-hosted
* the quote endpoint calculates gas costs and execution fees

But “how much they actually charge customers” and “what the margin is” are not publicly spelled out the way ZeroDev does. This should be honestly labeled as **pricing not fully publicly disclosed**. 

### Cost conclusion

If your goal is to find the provider whose public information allows the most transparent cost accounting:

* **ZeroDev is the most transparent**, because it even explicitly states the 5% exchange-rate markup for ERC20 gas.
* **Turnkey comes next**, because its signature pricing is very clear, but the detailed sponsorship margin is not public.
* **Biconomy / MetaMask** lean more toward requiring either direct vendor discussions or self-assembly. 

---

## 2.3 Implementation plan

## 2.3.1 Which provider(s) do you recommend? Why?

### Question

Which provider(s) do you recommend? Why?

### Answer

If your goal is to do a **research-oriented comparison of EVM gas sponsorship for Tesser**, and ultimately land on a usable implementation, I would give a two-layer recommendation:

### First choice: ZeroDev

The reason is that it is the most suitable for research and MVP validation.

Across nearly all the dimensions you want to compare—7702, sponsor gas, ERC20 gas payment, paymaster, bundler, pricing, gas policy—ZeroDev has a relatively complete, public, and internally consistent product narrative. It makes apples-to-apples comparison easier, and it is also the easiest to demo. 

### Production-enhancing option: Turnkey + ZeroDev

If, in the future, you want to improve both security and user experience, I would more strongly recommend using Turnkey as the signer / wallet infrastructure, and ZeroDev as the AA / paymaster layer.

The reason is that Turnkey is stronger in enterprise wallet capabilities such as key management, wallet infrastructure, policy, and transaction management, while ZeroDev is more mature on the AA / gas abstraction side. The combination of the two is the most balanced. 

---

## 2.3.2 What’s the implementation plan?

### Question

What’s the implementation plan?

### Answer

I recommend dividing the implementation plan into two phases:

### Phase 1: Research and MVP

Use ZeroDev alone to get a minimal viable flow working:

1. Build the 7702 flow.
2. Enable sponsor gas.
3. Add ERC20 gas payment.
4. Record three core metrics: success rate, latency, and cost per transaction.

Because ZeroDev’s official support for these parts is direct, and its pricing / sponsorship information is relatively public and transparent, it is the best place to validate first. 

### Phase 2: Production design

Switch the signer / wallet infrastructure to Turnkey + ZeroDev:

1. Use Turnkey to manage user wallets / embedded wallets / signer.
2. Use ZeroDev to provide 7702, bundler, paymaster, and ERC20 gas payment.
3. Add policy controls in Turnkey, such as limiting which contracts, function selectors, and maximum amounts can be sponsored.
4. Define different gas policies for different user segments. 
