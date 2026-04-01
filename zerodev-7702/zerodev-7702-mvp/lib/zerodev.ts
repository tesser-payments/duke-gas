import {
  createPublicClient,
  createWalletClient,
  http,
  type Hex,
  type PrivateKeyAccount,
} from "viem"
import { privateKeyToAccount } from "viem/accounts"
import {
  createKernelAccount,
  createKernelAccountClient,
  createZeroDevPaymasterClient,
  constants,
} from "@zerodev/sdk"

import { sepolia } from "./config"

const ZERODEV_RPC = process.env.NEXT_PUBLIC_ZERODEV_RPC as string
const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL as string
const PRIVATE_KEY = process.env.NEXT_PUBLIC_TEST_PRIVATE_KEY as Hex

if (!ZERODEV_RPC) {
  throw new Error("Missing NEXT_PUBLIC_ZERODEV_RPC in .env.local")
}

if (!RPC_URL) {
  throw new Error("Missing NEXT_PUBLIC_RPC_URL in .env.local")
}

if (!PRIVATE_KEY) {
  throw new Error("Missing NEXT_PUBLIC_TEST_PRIVATE_KEY in .env.local")
}

export function getPublicClient() {
  return createPublicClient({
    chain: sepolia,
    transport: http(RPC_URL),
  })
}

export function getLocalAccount(): PrivateKeyAccount {
  return privateKeyToAccount(PRIVATE_KEY)
}

export function getLocalWalletClient() {
  const account = getLocalAccount()

  return createWalletClient({
    account,
    chain: sepolia,
    transport: http(RPC_URL),
  })
}

export async function sign7702Authorization() {
  const publicClient = getPublicClient()
  const walletClient = getLocalWalletClient()
  const account = getLocalAccount()

  const nonce = await publicClient.getTransactionCount({
  address: account.address,
  blockTag: "pending",
})

const authorization = await walletClient.signAuthorization({
  account,
  contractAddress: constants.KERNEL_7702_DELEGATION_ADDRESS,
  executor: "self",
  nonce,
})

  return {
    publicClient,
    walletClient,
    account,
    authorization,
  }
}

export async function submit7702Authorization() {
  const { publicClient, walletClient, account, authorization } =
    await sign7702Authorization()

  const hash = await walletClient.sendTransaction({
    account,
    to: account.address,
    value: 0n,
    data: "0x",
    authorizationList: [authorization],
    type: "eip7702",
  })

  const receipt = await publicClient.waitForTransactionReceipt({ hash })

  return {
    publicClient,
    account,
    authorization,
    hash,
    receipt,
  }
}

export async function create7702Client(useSponsorGas: boolean = false) {
  const publicClient = getPublicClient()
  const account = getLocalAccount()
  const { authorization } = await sign7702Authorization()

  const entryPoint = constants.getEntryPoint("0.7")

const kernelAccount = await createKernelAccount(publicClient, {
  entryPoint,
  kernelVersion: constants.KERNEL_V3_3,
  eip7702Account: account,
  eip7702Auth: authorization,
})

  const clientConfig: any = {
    account: kernelAccount,
    chain: sepolia,
    bundlerTransport: http(ZERODEV_RPC),
  }

  if (useSponsorGas) {
    clientConfig.paymaster = createZeroDevPaymasterClient({
      transport: http(ZERODEV_RPC),
    })
  }

  const kernelClient = createKernelAccountClient(clientConfig)

  return {
    publicClient,
    account,
    kernelAccount,
    kernelClient,
  }
}

export async function sendBasic7702Tx(recipient: `0x${string}`) {
  const { publicClient, kernelClient } = await create7702Client(false)

  const hash = await kernelClient.sendTransaction({
    to: recipient,
    value: 0n,
    data: "0x",
  })

  const receipt = await publicClient.waitForTransactionReceipt({ hash })

  return {
    hash,
    receipt,
  }
}

export async function sendSponsored7702Tx(recipient: `0x${string}`) {
  const { publicClient, kernelClient } = await create7702Client(true)

  const hash = await kernelClient.sendTransaction({
    to: recipient,
    value: 0n,
    data: "0x",
  })

  const receipt = await publicClient.waitForTransactionReceipt({ hash })

  return {
    hash,
    receipt,
  }
}

export async function runFull7702Flow(recipient: `0x${string}`) {
  const authResult = await submit7702Authorization()
  const txResult = await sendBasic7702Tx(recipient)

  return {
    authorizationHash: authResult.hash,
    authorizationReceipt: authResult.receipt,
    txHash: txResult.hash,
    txReceipt: txResult.receipt,
    totalGasUsed: authResult.receipt.gasUsed + txResult.receipt.gasUsed,
  }
}