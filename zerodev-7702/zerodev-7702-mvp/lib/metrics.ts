export type TxMetric = {
  scenario: string
  success: boolean
  latencyMs: number
  gasUsed?: string
  effectiveGasPrice?: string
  costWei?: string
  txHash?: string
  error?: string
}

export function buildMetric(params: {
  scenario: string
  success: boolean
  latencyMs: number
  gasUsed?: bigint
  effectiveGasPrice?: bigint
  txHash?: string
  error?: string
}): TxMetric {
  let costWei: string | undefined = undefined

  if (
    params.gasUsed !== undefined &&
    params.effectiveGasPrice !== undefined
  ) {
    costWei = (params.gasUsed * params.effectiveGasPrice).toString()
  }

  return {
    scenario: params.scenario,
    success: params.success,
    latencyMs: params.latencyMs,
    gasUsed: params.gasUsed?.toString(),
    effectiveGasPrice: params.effectiveGasPrice?.toString(),
    costWei,
    txHash: params.txHash,
    error: params.error,
  }
}