## CompareGas.ts

yong@chenpinyangdeMacBook-Air sponsorship-api % npx tsx compareGas.ts
◇ injected env (15) from .env // tip: ⌘ suppress logs { quiet: true }

=== Experiment Config ===
{
runCount: 1440,
delayMs: 600000,
csvFile: 'gas-results.csv',
account: '0xA61Dd89a50CA4Cc3FD1ECe44cA666B138a2900AB',
toAddress: '0xCC213cb9578565c25B2365C4d586cf2F88F04BE0'
}

=== Starting Run 1 ===

=== Sending unsponsored EIP-1559 transaction ===
Unsponsored tx hash: 0x1489035239eea5d3720b453c328c3dd7fe7770a18a640330ed79906c5dc18aa4
gasUsed: 21000
effectiveGasPrice: 6583299
actualFeeWei: 138249279000
actualFeeETH: 0.000000138249279
latencyMs: 4637

=== Unsponsored Result ===
{
txHash: '0x1489035239eea5d3720b453c328c3dd7fe7770a18a640330ed79906c5dc18aa4',
gasUsed: '21000',
effectiveGasPrice: '6583299',
actualFeeWei: '138249279000',
actualFeeETH: '0.000000138249279',
latencyMs: 4637
}

=== Calling /sponsorships/prepare ===
prepare response: {
"message": "prepare endpoint works",
"input": {
"from": "0xA61Dd89a50CA4Cc3FD1ECe44cA666B138a2900AB",
"to": "0xCC213cb9578565c25B2365C4d586cf2F88F04BE0",
"data": "0x",
"value": "0"
},
"unsignedUserOp": {
"stage": "prepared",
"sponsorEnabled": true,
"requestedFrom": "0xA61Dd89a50CA4Cc3FD1ECe44cA666B138a2900AB",
"actualSignerAddress": "0xA61Dd89a50CA4Cc3FD1ECe44cA666B138a2900AB",
"kernelAccountAddress": "0xA61Dd89a50CA4Cc3FD1ECe44cA666B138a2900AB",
"call": {
"to": "0xCC213cb9578565c25B2365C4d586cf2F88F04BE0",
"data": "0x",
"value": "0"
},
"userOp": {
"callData": "0xe9ae5c53000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000034CC213cb9578565c25B2365C4d586cf2F88F04BE00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
"paymaster": "0x777777777777AeC03fd955926DbF81597e66834C",
"sender": "0xA61Dd89a50CA4Cc3FD1ECe44cA666B138a2900AB",
"maxFeePerGas": "79349454",
"maxPriorityFeePerGas": "71614268",
"nonce": "6",
"signature": "0xfffffffffffffffffffffffffffffff0000000000000000000000000000000007aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1c",
"callGasLimit": "17955",
"verificationGasLimit": "41810",
"preVerificationGas": "50508",
"paymasterVerificationGasLimit": "35470",
"paymasterPostOpGasLimit": "1",
"paymasterData": "0x01000069d59d160000000000005ca15dc464241af623961d5d13058df12fa28b92011b10a201ebf2dee90f4bb209c87be9751cc3f0ff9c3c0a9e7cc1999224ba814bfa304683f876369044a0921c"
},
"note": "ZeroDev handled gas + paymaster automatically via kernelClient."
}
}

=== Signing sponsored UserOperation ===
[debug] sender: 0xA61Dd89a50CA4Cc3FD1ECe44cA666B138a2900AB
[debug] nonce: 6

=== Signed UserOperation ===
{
"callData": "0xe9ae5c53000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000034CC213cb9578565c25B2365C4d586cf2F88F04BE00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
"paymaster": "0x777777777777AeC03fd955926DbF81597e66834C",
"sender": "0xA61Dd89a50CA4Cc3FD1ECe44cA666B138a2900AB",
"maxFeePerGas": "79349454",
"maxPriorityFeePerGas": "71614268",
"nonce": "6",
"signature": "0xf3ccf1227492f625ad233d7629ccb113255cbfed19f4759a996c42c8ead0f27f3637cd34de760fc14b4aa4e12dbb5f14a1d92c1f769e91a2a4e6d3472147b2111c",
"callGasLimit": "17955",
"verificationGasLimit": "41810",
"preVerificationGas": "50508",
"paymasterVerificationGasLimit": "35470",
"paymasterPostOpGasLimit": "1",
"paymasterData": "0x01000069d59d160000000000005ca15dc464241af623961d5d13058df12fa28b92011b10a201ebf2dee90f4bb209c87be9751cc3f0ff9c3c0a9e7cc1999224ba814bfa304683f876369044a0921c"
}

=== Calling /sponsorships/submit ===
submit response: {
"userOpHash": "0x4354befdbc22839140468ffcdc59c2f66f1d4fa6f7e2848b0929717317aa8625",
"txHash": "0x2d94e520d6e794710ab627eaca95fcdfe14d06aa204927f4748db63b9211d9c6"
}

=== Sponsored Result ===
{
userOpHash: '0x4354befdbc22839140468ffcdc59c2f66f1d4fa6f7e2848b0929717317aa8625',
txHash: '0x2d94e520d6e794710ab627eaca95fcdfe14d06aa204927f4748db63b9211d9c6',
latencyMs: 12766
}

=== Sponsored On-chain Cost ===
{
txHash: '0x2d94e520d6e794710ab627eaca95fcdfe14d06aa204927f4748db63b9211d9c6',
gasUsed: '107497',
effectiveGasPrice: '73960258',
actualFeeWei: '7950505854226',
actualFeeETH: '0.000007950505854226'
}

=== Sponsored Gas Breakdown ===
{
callGasLimit: '17955',
verificationGasLimit: '41810',
preVerificationGas: '50508',
paymasterVerificationGasLimit: '35470',
paymasterPostOpGasLimit: '1'
}

=== Comparison ===
{
unsponsoredNetworkCostWei: '138249279000',
unsponsoredNetworkCostETH: '0.000000138249279',
sponsoredNetworkCostWei: '7950505854226',
sponsoredNetworkCostETH: '0.000007950505854226',
unsponsoredUserPaysWei: '138249279000',
unsponsoredUserPaysETH: '0.000000138249279',
sponsoredUserPaysWei: '0',
sponsoredUserPaysETH: '0'
}

=== Run 1 Summary ===
{
unsponsoredTxHash: '0x1489035239eea5d3720b453c328c3dd7fe7770a18a640330ed79906c5dc18aa4',
unsponsoredGasUsed: '21000',
unsponsoredEffectiveGasPrice: '6583299',
unsponsoredActualFeeWei: '138249279000',
unsponsoredActualFeeETH: '0.000000138249279',
unsponsoredLatencyMs: 4637,
sponsoredUserOpHash: '0x4354befdbc22839140468ffcdc59c2f66f1d4fa6f7e2848b0929717317aa8625',
sponsoredTxHash: '0x2d94e520d6e794710ab627eaca95fcdfe14d06aa204927f4748db63b9211d9c6',
sponsoredLatencyMs: 12766,
sponsoredGasUsed: '107497',
sponsoredEffectiveGasPrice: '73960258',
sponsoredActualFeeWei: '7950505854226',
sponsoredActualFeeETH: '0.000007950505854226',
sponsoredCallGasLimit: '17955',
sponsoredVerificationGasLimit: '41810',
sponsoredPreVerificationGas: '50508',
sponsoredPaymasterVerificationGasLimit: '35470',
sponsoredPaymasterPostOpGasLimit: '1',
unsponsoredUserPaysWei: '138249279000',
unsponsoredUserPaysETH: '0.000000138249279',
sponsoredUserPaysWei: '0',
sponsoredUserPaysETH: '0'
}

Waiting 600000 ms before next run...
