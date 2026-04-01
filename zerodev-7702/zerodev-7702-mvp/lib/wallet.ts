import { createWalletClient, custom } from "viem"
import { sepolia } from "./config"

declare global {
  interface Window {
    ethereum?: any
  }
}

export function getWalletClient() {
  if (!window.ethereum) {
    throw new Error("MetaMask not found")
  }

  return createWalletClient({
    chain: sepolia,
    transport: custom(window.ethereum),
  })
}

export async function connectMetaMask() {
  if (!window.ethereum) {
    throw new Error("MetaMask not found")
  }

  const walletClient = getWalletClient()

  // 這會要求 MetaMask 連線帳戶
  const addresses = await window.ethereum.request({
    method: "eth_requestAccounts",
  })

  return {
    walletClient,
    address: addresses[0],
  }
}