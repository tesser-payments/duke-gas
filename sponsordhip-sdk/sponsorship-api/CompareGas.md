# Column Explanation

## General Information

- **timestamp**
  This is the time when I recorded each experiment run.

- **runIndex**
  This indicates which run of the experiment this row corresponds to.

---

## Unsponsored Transaction Fields

- **unsponsoredTxHash**
  This is the on-chain transaction hash for the unsponsored transaction I sent.

- **unsponsoredGasUsed**
  This represents how much gas the transaction actually consumed.

- **unsponsoredEffectiveGasPriceWei**
  This is the actual gas price I paid per unit of gas, in wei.

- **unsponsoredActualFeeWei**
  This is the total transaction fee I paid, calculated as gas used multiplied by gas price.

- **unsponsoredActualFeeETH**
  This is the same transaction fee converted into ETH for easier interpretation.

- **unsponsoredLatencyMs**
  This measures how long it took, in milliseconds, from sending the transaction to receiving the receipt.

---

## Sponsored Transaction Fields

- **sponsoredUserOpHash**
  This is the UserOperation hash in the ERC-4337 flow, which represents the abstracted transaction before it is submitted on-chain.

- **sponsoredTxHash**
  This is the final on-chain transaction hash after the bundler submits the UserOperation.

- **sponsoredGasUsed**
  This represents the actual gas consumed by the sponsored transaction on-chain.

- **sponsoredEffectiveGasPriceWei**
  This is the effective gas price used for the sponsored transaction.

- **sponsoredActualFeeWei**
  This is the total on-chain cost of the sponsored transaction.

- **sponsoredActualFeeETH**
  This is the sponsored transaction fee expressed in ETH.

- **sponsoredLatencyMs**
  This measures the total time for the full sponsored flow, including prepare, sign, submit, and confirmation.

---

## Sponsored Gas Breakdown

- **sponsoredCallGasLimit**
  This is the gas allocated for executing the actual transaction logic.

- **sponsoredVerificationGasLimit**
  This is the gas allocated for smart account validation.

- **sponsoredPreVerificationGas**
  This represents the overhead cost for packaging and preparing the UserOperation.

- **sponsoredPaymasterVerificationGasLimit**
  This is the gas allocated for paymaster validation.

- **sponsoredPaymasterPostOpGasLimit**
  This is the gas allocated for the paymaster’s post-operation logic.

---

## User Payment Fields

- **unsponsoredUserPaysWei / ETH**
  This represents how much I actually paid when sending the unsponsored transaction.

- **sponsoredUserPaysWei / ETH**
  This represents how much I paid in the sponsored case.

  In my experiment, this value is always zero, which means the user does not pay any gas directly.

---

# Results Analysis

## 1. My unsponsored transactions are very stable

From the data, I can see that:

- Every unsponsored transaction used exactly **21,000 gas**
- This matches the expected cost for a simple ETH transfer

This tells me that:

> My baseline measurements are clean and reliable.

---

## 2. The sponsored flow is also highly consistent

Looking at the sponsored transactions:

- Gas usage is consistently around **107,000 gas**

This suggests that:

> The account abstraction flow introduces a fixed and predictable overhead.

---

## 3. Sponsored transactions are significantly more expensive

When I compare the costs:

- Unsponsored transactions cost around **10⁻⁷ ETH**
- Sponsored transactions cost around **10⁻⁶ to 10⁻⁵ ETH**

This means:

> Sponsored transactions are roughly 10x to 50x more expensive at the network level.

---

## 4. Most of the extra cost comes from account abstraction overhead

From the gas breakdown:

- The actual call uses only about **17k gas**
- The majority of gas is consumed by:
  - verification
  - preVerification
  - paymaster logic

So I can conclude:

> The additional cost is not from the user’s action, but from the infrastructure required by ERC-4337.

---

## 5. Sponsored transactions often use higher gas prices

I also observe that:

- Sponsored transactions sometimes have higher effective gas prices than unsponsored ones

This suggests:

> The bundler or paymaster may be prioritizing faster inclusion by bidding higher gas prices.

---

## 6. The user pays nothing in the sponsored model

From the data:

- Unsponsored: I pay the full gas fee
- Sponsored: I pay **0**

This is the key insight:

> Gas sponsorship shifts the cost from the user to the system.

---

## 7. Latency is roughly comparable

From the latency data:

- Unsponsored: ~12–13 seconds
- Sponsored: ~10–12 seconds

This tells me:

> The sponsored flow does not introduce a significant latency penalty in this sample.

---

## 8. There is some variability in sponsored cost

I notice that:

- Some runs (e.g., run 2) are significantly more expensive
- Some runs (e.g., run 9) are much cheaper

This indicates:

> Sponsored transaction cost is sensitive to gas price fluctuations.

---

# Final Takeaway

From this experiment, I can conclude that:

- Gas sponsorship significantly improves user experience by removing the need for users to hold or spend ETH
- However, it introduces a consistent and non-trivial overhead due to account abstraction
- The cost increase is predictable, but still substantial
- Latency remains acceptable in my test environment
