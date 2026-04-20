import { polygon, base } from 'viem/chains';

export const APP_CHAINS = {
  polygon: {
    key: 'polygon',
    chain: polygon,
    chainId: polygon.id,
    rpcUrl:
      process.env.NEXT_PUBLIC_RPC_URL_POLYGON || 'https://polygon-rpc.com',
    bundlerRpcUrl: process.env.NEXT_PUBLIC_BUNDLER_RPC_URL_POLYGON || '',
    apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001',
    label: 'Polygon',
  },
  base: {
    key: 'base',
    chain: base,
    chainId: base.id, // 8453
    rpcUrl: process.env.NEXT_PUBLIC_RPC_URL_BASE || 'https://mainnet.base.org',
    bundlerRpcUrl: process.env.NEXT_PUBLIC_BUNDLER_RPC_URL_BASE || '',
    apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001',
    label: 'Base',
  },
} as const;

export type AppChainKey = keyof typeof APP_CHAINS;
