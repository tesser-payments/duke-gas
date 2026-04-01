"use client"

import { useState } from "react"
import { connectMetaMask } from "@/lib/wallet"
import { buildMetric, TxMetric } from "@/lib/metrics"
import { sendBasic7702Tx, sendSponsored7702Tx } from "@/lib/zerodev"

export default function ZeroDev7702Panel() {
  const [address, setAddress] = useState("")
  const [status, setStatus] = useState("Not connected")
  const [metrics, setMetrics] = useState<TxMetric[]>([])

  async function handleConnect() {
    try {
      const result = await connectMetaMask()
      setAddress(result.address)
      setStatus("MetaMask connected")
    } catch (error: any) {
      setStatus(error.message || "Connect failed")
    }
  }

  async function runBasicFlow() {
    if (!address) {
      setStatus("Please connect MetaMask first")
      return
    }

    const start = Date.now()

    try {
      const { hash, receipt } = await sendBasic7702Tx(
        address as `0x${string}`
      )

      const latencyMs = Date.now() - start

      const metric = buildMetric({
        scenario: "basic-7702",
        success: true,
        latencyMs,
        gasUsed: receipt.gasUsed,
        effectiveGasPrice: receipt.effectiveGasPrice,
        txHash: hash,
      })

      setMetrics((prev) => [metric, ...prev])
      setStatus("Basic 7702 success")
    } catch (error: any) {
      const latencyMs = Date.now() - start

      const metric = buildMetric({
        scenario: "basic-7702",
        success: false,
        latencyMs,
        error: error.message || "Unknown error",
      })

      setMetrics((prev) => [metric, ...prev])
      setStatus("Basic 7702 failed")
    }
  }

  async function runSponsoredFlow() {
    if (!address) {
      setStatus("Please connect MetaMask first")
      return
    }

    const start = Date.now()

    try {
      const { hash, receipt } = await sendSponsored7702Tx(
        address as `0x${string}`
      )

      const latencyMs = Date.now() - start

      const metric = buildMetric({
        scenario: "sponsored-7702",
        success: true,
        latencyMs,
        gasUsed: receipt.gasUsed,
        effectiveGasPrice: receipt.effectiveGasPrice,
        txHash: hash,
      })

      setMetrics((prev) => [metric, ...prev])
      setStatus("Sponsored 7702 success")
    } catch (error: any) {
      const latencyMs = Date.now() - start

      const metric = buildMetric({
        scenario: "sponsored-7702",
        success: false,
        latencyMs,
        error: error.message || "Unknown error",
      })

      setMetrics((prev) => [metric, ...prev])
      setStatus("Sponsored 7702 failed")
    }
  }

  const total = metrics.length
  const successCount = metrics.filter((item) => item.success).length
  const successRate = total > 0 ? ((successCount / total) * 100).toFixed(2) : "0.00"

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-4">
      <h1 className="text-2xl font-bold">ZeroDev 7702 MVP on Sepolia</h1>

      <div className="border rounded-xl p-4 space-y-2">
        <p><strong>Status:</strong> {status}</p>
        <p><strong>Recipient Address:</strong> {address || "-"}</p>
        <p className="text-sm text-gray-600">
          Connect MetaMask only to choose the recipient address. The 7702 flow itself is currently using the local test account from <code>.env.local</code>.
        </p>

        <div className="flex gap-3 flex-wrap">
          <button
            onClick={handleConnect}
            className="px-4 py-2 rounded-lg border"
          >
            Connect MetaMask
          </button>

          <button
            onClick={runBasicFlow}
            className="px-4 py-2 rounded-lg border"
          >
            Run Basic 7702
          </button>

          <button
            onClick={runSponsoredFlow}
            className="px-4 py-2 rounded-lg border"
          >
            Run Sponsored 7702
          </button>
        </div>
      </div>

      <div className="border rounded-xl p-4 space-y-1">
        <h2 className="text-lg font-semibold">Metrics Summary</h2>
        <p>Total Runs: {total}</p>
        <p>Success Count: {successCount}</p>
        <p>Success Rate: {successRate}%</p>
      </div>

      <div className="border rounded-xl p-4">
        <h2 className="text-lg font-semibold mb-3">Run Logs</h2>

        <div className="space-y-3">
          {metrics.map((metric, index) => (
            <div key={index} className="border rounded-lg p-3">
              <p><strong>Scenario:</strong> {metric.scenario}</p>
              <p><strong>Success:</strong> {String(metric.success)}</p>
              <p><strong>Latency:</strong> {metric.latencyMs} ms</p>
              <p><strong>Gas Used:</strong> {metric.gasUsed || "-"}</p>
              <p><strong>Effective Gas Price:</strong> {metric.effectiveGasPrice || "-"}</p>
              <p><strong>Cost (Wei):</strong> {metric.costWei || "-"}</p>
              <p><strong>Tx Hash:</strong> {metric.txHash || "-"}</p>
              <p><strong>Error:</strong> {metric.error || "-"}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}