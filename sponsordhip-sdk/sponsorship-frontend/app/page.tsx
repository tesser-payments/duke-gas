"use client";
import { useMemo, useState } from "react";
import {
  Address,
  Hex,
  createPublicClient,
  createWalletClient,
  custom,
  http,
} from "viem";
import { polygon, base } from "viem/chains";

import {
  constants,
  createKernelAccount,
  createKernelAccountClient,
} from "@zerodev/sdk";
import { signerToEcdsaValidator } from "@zerodev/ecdsa-validator";
import { getERC20PaymasterApproveCall } from "@zerodev/sdk";

const ENTRYPOINT_V07 = {
  address: "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
  version: "0.7",
} as any;

declare global {
  interface Window {
    ethereum?: any;
  }
}

type SponsorshipType = "verifying" | "erc20";

type AppChain = {
  key: string;
  chain: any;
  chainId: number;
  label: string;
  rpcUrl: string;
  bundlerRpcUrl: string;
};

const CHAINS: Record<string, AppChain> = {
  polygon: {
    key: "polygon",
    chain: polygon,
    chainId: polygon.id,
    label: "Polygon",
    rpcUrl: process.env.NEXT_PUBLIC_POLYGON_RPC_URL || "https://rpc.ankr.com/polygon",
    bundlerRpcUrl: process.env.NEXT_PUBLIC_BUNDLER_RPC_URL_POLYGON || "",
  },
  base: {
    key: "base",
    chain: base,
    chainId: base.id,
    label: "Base",
    rpcUrl: process.env.NEXT_PUBLIC_BASE_RPC_URL || "https://mainnet.base.org",
    bundlerRpcUrl: process.env.NEXT_PUBLIC_BUNDLER_RPC_URL_BASE || "",
  },
};

type PreparedUserOp = {
  sender: Address;
  nonce: Hex;
  callData: Hex;
  signature?: Hex;

  callGasLimit?: Hex;
  verificationGasLimit?: Hex;
  preVerificationGas?: Hex;

  maxFeePerGas?: Hex;
  maxPriorityFeePerGas?: Hex;

  paymaster?: Address;
  paymasterData?: Hex;
  paymasterVerificationGasLimit?: Hex;
  paymasterPostOpGasLimit?: Hex;

  factory?: Address;
  factoryData?: Hex;

  authorization?: any;

  [key: string]: any;
};

type PrepareResponse = {
  stage?: string;
  sponsorEnabled?: boolean;
  sponsorType?: "verifying" | "erc20";
  requestedFrom?: string;
  actualSignerAddress?: string;
  kernelAccountAddress?: string;
  call?: {
    to: string;
    data: Hex;
    value: string;
  };
  userOp?: PreparedUserOp;
  unsignedUserOp?: {
    userOp?: PreparedUserOp;
    kernelAccountAddress?: string;
  };
  note?: string;
};

type SubmitResponse = {
  userOpHash: string;
  txHash: string;
  error?: string;
};

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";

const API_KEY = process.env.NEXT_PUBLIC_API_KEY || "";

export default function Page() {
  const [selectedChain, setSelectedChain] = useState<string>("polygon");
  const [walletAddress, setWalletAddress] = useState<Address | null>(null);
  const [sender, setSender] = useState<Address | "">("");
  const [ type, setType ] = useState<SponsorshipType>( "verifying" );
  const [factory, setFactory] = useState("");
const [factoryData, setFactoryData] = useState("");

  const [to, setTo] = useState("");
  const [data, setData] = useState("0x");
  const [ value, setValue ] = useState( "0x0" );
  const [encodedCallData, setEncodedCallData] = useState<Hex | "">("");

  const [preparedUserOp, setPreparedUserOp] = useState<PreparedUserOp | null>(null);
  const [signedUserOp, setSignedUserOp] = useState<PreparedUserOp | null>(null);

  const [userOpHash, setUserOpHash] = useState("");
  const [ txHash, setTxHash ] = useState( "" );
  const [lastSubmittedNonce, setLastSubmittedNonce] = useState("");

  const [loadingConnect, setLoadingConnect] = useState(false);
  const [loadingDeriveSender, setLoadingDeriveSender] = useState(false);
  const [loadingPrepare, setLoadingPrepare] = useState(false);
const [loadingSign, setLoadingSign] = useState(false);
const [loadingSubmit, setLoadingSubmit] = useState(false);
const [loadingDeployFirstTx, setLoadingDeployFirstTx] = useState(false);
const [firstTxSent, setFirstTxSent] = useState(false);

  const [logs, setLogs] = useState<string[]>([]);

  const prettyPrepared = useMemo(
  () =>
    preparedUserOp
      ? JSON.stringify(
          preparedUserOp,
          (_, value) => (typeof value === "bigint" ? value.toString() : value),
          2
        )
      : "",
  [preparedUserOp]
);

  const prettySigned = useMemo(
  () =>
    signedUserOp
      ? JSON.stringify(
          signedUserOp,
          (_, value) => (typeof value === "bigint" ? value.toString() : value),
          2
        )
      : "",
  [signedUserOp]
);

  function addLog(message: string) {
    setLogs((prev) => [
      `[${new Date().toLocaleTimeString()}] ${message}`,
      ...prev,
    ]);
  }

  function resetFlowAfterWalletChange() {
  setSender("");
  setFactory("");
  setFactoryData("");
  setEncodedCallData("");
  setPreparedUserOp(null);
  setSignedUserOp(null);
  setUserOpHash("");
  setTxHash("");
  setLastSubmittedNonce("");
}

  function resetFlowAfterChainChange(nextChainKey: string) {
  resetFlowAfterWalletChange();
  setFirstTxSent(false);
  addLog(`切換到 ${CHAINS[nextChainKey].label}`);
}

  const currentChain = CHAINS[ selectedChain ];
  const isBaseFirstDeployment =
  currentChain.key === "base" && !!factory && !!factoryData;

  function createViemSigner(walletClient: any, address: string) {
    return {
      getAddress: async () => address,

      signMessage: async ({ message }: { message: string }) => {
        return await walletClient.signMessage({
          account: address,
          message,
        });
      },

      signTypedData: async (params: any) => {
        return await walletClient.signTypedData({
          account: address,
          ...params,
        });
      },

      signTransaction: async (tx: any) => {
        return await walletClient.signTransaction({
          account: address,
          ...tx,
        });
      },
    };
  }

  async function connectMetaMask() {
    try {
      setLoadingConnect(true);

      if (!window.ethereum) {
        throw new Error("MetaMask not found. Please install MetaMask.");
      }

      const walletClient = createWalletClient({
        chain: currentChain.chain,
        transport: custom(window.ethereum),
      });

      const [address] = await walletClient.requestAddresses();

      if (!address) {
        throw new Error("No MetaMask account selected.");
      }

      setWalletAddress(address);
      resetFlowAfterWalletChange();
      addLog(`MetaMask connected: ${address}`);
    } catch (error: any) {
      addLog(`Connect error: ${error?.message || String(error)}`);
    } finally {
      setLoadingConnect(false);
    }
  }

  async function buildKernelContext(requireBundler: boolean = false) {
  if (!window.ethereum) {
    throw new Error("MetaMask not found.");
  }

  const walletClient = createWalletClient({
    chain: currentChain.chain,
    transport: custom(window.ethereum),
  });

  const [selectedAddress] = await walletClient.requestAddresses();

  if (!selectedAddress) {
    throw new Error("No MetaMask account selected.");
  }

  if (
    walletAddress &&
    selectedAddress.toLowerCase() !== walletAddress.toLowerCase()
  ) {
    throw new Error("MetaMask selected account does not match connected account.");
  }

  const publicClient = createPublicClient({
    chain: currentChain.chain,
    transport: http(currentChain.rpcUrl),
  });

  const ecdsaValidator = await signerToEcdsaValidator(publicClient as any, {
    signer: walletClient,
    entryPoint: ENTRYPOINT_V07,
    kernelVersion: constants.KERNEL_V3_3,
  } as any);

  const kernelAccount = await createKernelAccount(publicClient as any, {
    entryPoint: ENTRYPOINT_V07,
    kernelVersion: constants.KERNEL_V3_3,
    plugins: {
      sudo: ecdsaValidator,
    },
  });

  const result: any = {
    walletClient,
    publicClient,
    selectedAddress,
    kernelAccount,
  };

  if (requireBundler) {
    if (!currentChain.bundlerRpcUrl) {
      throw new Error(`Missing bundler RPC URL for ${currentChain.label}`);
    }

    result.kernelClient = createKernelAccountClient({
      account: kernelAccount,
      chain: currentChain.chain,
      bundlerTransport: http(currentChain.bundlerRpcUrl),
    });
  }

  return result;
}

  async function handleDeriveSender() {
  try {
    setLoadingDeriveSender(true);

    if (!window.ethereum) {
      throw new Error("MetaMask not found.");
    }

    if (!walletAddress) {
      throw new Error("Please connect MetaMask first.");
    }

    addLog("Deriving smart account sender ...");

    const walletClient = createWalletClient({
      chain: currentChain.chain,
      transport: custom(window.ethereum),
    });

    const [selectedAddress] = await walletClient.requestAddresses();

    if (!selectedAddress) {
      throw new Error("No MetaMask account selected.");
    }

    if (selectedAddress.toLowerCase() !== walletAddress.toLowerCase()) {
      throw new Error(
        "MetaMask selected account does not match connected account."
      );
    }

    addLog(`Selected address: ${selectedAddress}`);

    const publicClient = createPublicClient({
      chain: currentChain.chain,
      transport: http(currentChain.rpcUrl),
    });

    addLog("Public client created.");

    addLog( "Creating ECDSA validator with wallet client." );
    

    const ecdsaValidator = await signerToEcdsaValidator(publicClient as any, {
  signer: walletClient,
  entryPoint: ENTRYPOINT_V07,
  kernelVersion: constants.KERNEL_V3_3,
} as any);

    addLog("ECDSA validator created.");

    const kernelAccount = await createKernelAccount(publicClient as any, {
      entryPoint: ENTRYPOINT_V07,
      kernelVersion: constants.KERNEL_V3_3,
      plugins: {
        sudo: ecdsaValidator,
      },
    } );
    
    console.log("kernelAccount =", kernelAccount);
console.log("kernelAccount keys =", Object.keys(kernelAccount || {}));
console.log("kernelAccount.address =", kernelAccount.address);
console.log("kernelAccount.factoryAddress =", kernelAccount.factoryAddress);

let deployed = true;
if (typeof kernelAccount.isDeployed === "function") {
  deployed = await kernelAccount.isDeployed();
  console.log("kernelAccount.isDeployed =", deployed);
}

let factoryArgs: any = null;
if (typeof kernelAccount.getFactoryArgs === "function") {
  factoryArgs = await kernelAccount.getFactoryArgs();
  console.log("kernelAccount.getFactoryArgs =", factoryArgs);
}

setSender(kernelAccount.address);

if (!deployed && factoryArgs) {
  setFactory(factoryArgs.factory ?? "");
  setFactoryData(factoryArgs.factoryData ?? "");
  addLog(`Factory set: ${factoryArgs.factory ?? "-"}`);
  addLog("Factory data captured for undeployed account.");
} else {
  setFactory("");
  setFactoryData("");
  addLog("Account already deployed. No factory data needed.");
}

setPreparedUserOp(null);
setSignedUserOp(null);
setUserOpHash("");
setTxHash("");

addLog(`Derived sender: ${kernelAccount.address}`);
  } catch (error: any) {
    console.error("handleDeriveSender error:", error);
    addLog(`Derive sender error: ${error?.message || String(error)}`);
  } finally {
    setLoadingDeriveSender(false);
  }
  }
  async function handleDeployFirstBaseTx() {
  try {
    setLoadingDeployFirstTx(true);
    setUserOpHash("");
    setTxHash("");

    if (!walletAddress) {
      throw new Error("Please connect MetaMask first.");
    }

    if (!sender) {
      throw new Error("Please derive sender first.");
    }

    if (!isBaseFirstDeployment) {
      throw new Error("This flow is only for Base first transaction with factory/factoryData.");
    }

    if (!to) {
      throw new Error("Please enter the target address.");
    }

    addLog("Base first transaction detected. Sending first tx without sponsor...");

    const { kernelAccount, kernelClient } = await buildKernelContext(true);

    if (
      kernelAccount.address.toLowerCase() !== sender.toLowerCase()
    ) {
      throw new Error(
        `Derived kernel account does not match sender. kernel=${kernelAccount.address}, sender=${sender}`
      );
    }

    const result = await kernelClient.sendTransaction({
      to: to as Address,
      data: (data || "0x") as Hex,
      value: BigInt(value || "0x0"),
    });

    const resultString = typeof result === "string" ? result : JSON.stringify(result);

    setUserOpHash(typeof result === "string" ? result : "");
    setFirstTxSent(true);

    addLog(`First Base self-paid transaction sent: ${resultString}`);
    addLog("Wait for confirmation, then click Derive Sender again.");
    addLog("If Factory / FactoryData disappear, return to normal sponsor flow.");
  } catch (error: any) {
    console.error("handleDeployFirstBaseTx error:", error);
    addLog(`Deploy first tx error: ${error?.message || String(error)}`);
  } finally {
    setLoadingDeployFirstTx(false);
  }
}

  async function handlePrepare() {
    try {
      setLoadingPrepare(true);
      setPreparedUserOp(null);
      setSignedUserOp(null);
      setUserOpHash("");
      setTxHash("");

      if (!API_KEY) {
        throw new Error("Missing NEXT_PUBLIC_API_KEY in .env.local");
      }

      if (!walletAddress) {
        throw new Error("Please connect MetaMask first.");
      }

      if (!sender) {
        throw new Error("Please derive sender first.");
      }

      if (!window.ethereum) {
  throw new Error("MetaMask not found.");
}

const walletClient = createWalletClient({
  chain: currentChain.chain,
  transport: custom(window.ethereum),
});

const [selectedAddress] = await walletClient.requestAddresses();

if (!selectedAddress) {
  throw new Error("No MetaMask account selected.");
}

if (selectedAddress.toLowerCase() !== walletAddress.toLowerCase()) {
  throw new Error("MetaMask selected account does not match connected account.");
}

const nonceRpcUrl = currentChain.bundlerRpcUrl || currentChain.rpcUrl;

const publicClient = createPublicClient({
  chain: currentChain.chain,
  transport: http(nonceRpcUrl),
});

addLog(`Nonce RPC = ${nonceRpcUrl}`);

const ecdsaValidator = await signerToEcdsaValidator(publicClient as any, {
  signer: walletClient,
  entryPoint: ENTRYPOINT_V07,
  kernelVersion: constants.KERNEL_V3_3,
} as any);

const kernelAccount = await createKernelAccount(publicClient as any, {
  entryPoint: ENTRYPOINT_V07,
  kernelVersion: constants.KERNEL_V3_3,
  plugins: {
    sudo: ecdsaValidator,
  },
} );
      
      // 檢查 sender 的 USDC balance
      const usdcAbi = [
        {
          type: "function",
          name: "balanceOf",
          stateMutability: "view",
          inputs: [{ name: "account", type: "address" }],
          outputs: [{ name: "", type: "uint256" }],
        },
      ] as const;
      
      const usdcBalance = await publicClient.readContract({
        address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
        abi: usdcAbi,
        functionName: "balanceOf",
        args: [kernelAccount.address],
      });
      
      console.log("sender usdc balance raw =", usdcBalance.toString());
      addLog(`Sender USDC raw balance = ${usdcBalance.toString()}`);

const userCall = {
  to: to as Address,
  data: (data || "0x") as Hex,
  value: BigInt(value || "0x0"),
};

let calls: Array<{
  to: Address;
  data: Hex;
  value?: bigint;
}> = [userCall];

if (type === "erc20") {
  if (!currentChain.bundlerRpcUrl) {
    throw new Error(`Missing bundler RPC URL for ${currentChain.label}`);
  }

  addLog("ERC20 mode: building approve call for ZeroDev paymaster...");

  const kernelClient = createKernelAccountClient({
    account: kernelAccount,
    chain: currentChain.chain,
    bundlerTransport: http(currentChain.bundlerRpcUrl),
  });

  const approveCall = await getERC20PaymasterApproveCall(
    kernelClient as any,
    {
      gasToken: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
      approveAmount: BigInt(1_000_000_000), // 1000 USDC
      entryPoint: ENTRYPOINT_V07 as any,
    }
  );

  console.log(
    "approveCall =",
    JSON.stringify(
      approveCall,
      (_, value) => (typeof value === "bigint" ? value.toString() : value),
      2
    )
  );
  addLog(`Approve call target: ${approveCall.to}`);

  calls = [
    {
      to: approveCall.to as Address,
      data: approveCall.data as Hex,
      value: BigInt(approveCall.value ?? 0),
    },
    userCall,
  ];
}

console.log("calls before encode =", calls);
addLog(`Calls count before encode = ${calls.length}`);

const encoded = await kernelAccount.encodeCalls(calls);
console.log("encoded length =", encoded.length);
addLog(`Encoded callData length = ${encoded.length}`);
      console.log("typeof kernelAccount.getNonce =", typeof (kernelAccount as any).getNonce);

if (typeof (kernelAccount as any).getNonce !== "function") {
  throw new Error("kernelAccount.getNonce() is not available");
}

const sdkNonceRaw = await (kernelAccount as any).getNonce();
const sdkNonceHex =
  typeof sdkNonceRaw === "bigint"
    ? (`0x${sdkNonceRaw.toString(16)}` as Hex)
    : ( sdkNonceRaw as Hex );
      if (
  lastSubmittedNonce &&
  sdkNonceHex.toLowerCase() === lastSubmittedNonce.toLowerCase()
) {
  throw new Error(
    `Nonce has not advanced yet. Current nonce is still ${sdkNonceHex}. Please wait a few seconds, click Derive Sender again, then Prepare again.`
  );
}
      const packedNonce =
  typeof sdkNonceRaw === "bigint" ? sdkNonceRaw : BigInt(sdkNonceRaw);

const nonceKey = packedNonce >> BigInt(64);
      const nonceSequence = packedNonce & ( ( BigInt( 1 ) << BigInt( 64 ) ) - BigInt( 1 ) );
      const onchainPackedNonce = await publicClient.readContract({
  address: ENTRYPOINT_V07.address as Address,
  abi: [
    {
      type: "function",
      name: "getNonce",
      stateMutability: "view",
      inputs: [
        { name: "sender", type: "address" },
        { name: "key", type: "uint192" },
      ],
      outputs: [{ name: "nonce", type: "uint256" }],
    },
  ],
  functionName: "getNonce",
  args: [kernelAccount.address, nonceKey],
});

const onchainKey = onchainPackedNonce >> BigInt(64);
const onchainSequence =
  onchainPackedNonce & ((BigInt(1) << BigInt(64)) - BigInt(1));

console.log("onchainPackedNonce =", onchainPackedNonce.toString());
console.log("onchainKey =", onchainKey.toString());
console.log("onchainSequence =", onchainSequence.toString());

addLog(`Onchain packed nonce = 0x${onchainPackedNonce.toString(16)}`);
addLog(`Onchain key = ${onchainKey.toString()}`);
addLog(`Onchain sequence = ${onchainSequence.toString()}`);

console.log("packedNonce =", packedNonce.toString());
console.log("nonceKey =", nonceKey.toString());
console.log("nonceSequence =", nonceSequence.toString());

addLog(`Nonce key = ${nonceKey.toString()}`);
addLog(`Nonce sequence = ${nonceSequence.toString()}`);

console.log("sdkNonceRaw =", sdkNonceRaw);
console.log("sdkNonceHex =", sdkNonceHex);



      console.log( "sdkNonceHex =", sdkNonceHex );
      console.log("sender used for sdkNonce =", kernelAccount.address);
console.log("selected type =", type);
console.log("factory =", factory);
console.log("factoryData =", factoryData);
addLog(`SDK nonce = ${sdkNonceHex}`);
      
    

setEncodedCallData(encoded);
console.log("encodedCallData =", encoded);
      addLog( `Encoded callData: ${ encoded.slice( 0, 42 ) }...` );
      if (isBaseFirstDeployment) {
  addLog("Base first transaction detected.");
  addLog("This tx still has factory/factoryData, so sponsor prepare will be skipped.");
  addLog("Please click 'Deploy Smart Account (Self-pay)' first.");
  return;
}

      addLog("Calling /sponsorships/prepare ...");
      
      console.log(
        "prepare request body =",
        JSON.stringify({
          chainId: currentChain.chainId,
          from: walletAddress,
          sender,
          nonce: sdkNonceHex,
          factory: factory || undefined,
          factoryData: factoryData || undefined,
          to,
          data,
          value,
          callData: encoded,
          type,
        }, null, 2)
      );
      
      const res = await fetch(`${API_BASE_URL}/sponsorships/prepare`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-KEY": API_KEY,
        },
        
        body: JSON.stringify({
  chainId: currentChain.chainId,
  from: walletAddress,
  sender,
  nonce: sdkNonceHex,
  factory: factory || undefined,
  factoryData: factoryData || undefined,
  to,
  data,
  value,
  callData: encoded,
  type,
}),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Prepare failed: ${text}`);
      }

     const rawText = await res.text();
console.log("prepare raw response text =", rawText);

const json = JSON.parse(rawText);
console.log("prepare parsed json =", json);
console.log("prepare parsed json keys =", Object.keys(json || {}));
console.log("prepare parsed json.userOp =", json?.userOp);
console.log(
  "prepare parsed json.unsignedUserOp?.userOp =",
  json?.unsignedUserOp?.userOp
);

const prepared = json?.userOp ?? json?.unsignedUserOp?.userOp;

if (!prepared) {
  throw new Error(
    `Prepare response missing userOp. Top-level keys: ${Object.keys(json || {}).join(", ")}`
  );
}

setPreparedUserOp(prepared);

console.log("input to =", to);
console.log("input data =", data);
console.log("input value =", value);
console.log("encodedCallData sent =", encoded);
console.log("prepared userOp =", prepared);
console.log("prepared userOp.callData =", prepared.callData);

addLog("Prepare success.");
addLog(`Prepared sender: ${prepared.sender}`);
addLog(`Prepared nonce: ${prepared.nonce}`);
    } catch (error: any) {
      addLog(`Prepare error: ${error?.message || String(error)}`);
    } finally {
      setLoadingPrepare(false);
    }
  }

  async function handleSign() {
  try {
    if (!API_KEY) {
      throw new Error("Missing NEXT_PUBLIC_API_KEY in .env.local");
    }

    setLoadingSign(true);

    if (!window.ethereum) {
      throw new Error("MetaMask not found.");
    }

    if (!preparedUserOp) {
      throw new Error("Please prepare first.");
    }

    if (!currentChain.bundlerRpcUrl) {
      throw new Error(`Missing bundler RPC URL for ${currentChain.label}`);
    }

    addLog("Creating viem wallet client from MetaMask ...");

    const walletClient = createWalletClient({
      chain: currentChain.chain,
      transport: custom(window.ethereum),
    });

    const [selectedAddress] = await walletClient.requestAddresses();

    if (!selectedAddress) {
      throw new Error("No MetaMask account selected.");
    }

    if (
      walletAddress &&
      selectedAddress.toLowerCase() !== walletAddress.toLowerCase()
    ) {
      throw new Error(
        "MetaMask selected account does not match connected account."
      );
    }

    const publicClient = createPublicClient({
      chain: currentChain.chain,
      transport: http(currentChain.rpcUrl),
    });

    addLog("Creating ECDSA validator with wallet client ...");

    const ecdsaValidator = await signerToEcdsaValidator(publicClient as any, {
      signer: walletClient,
      entryPoint: ENTRYPOINT_V07,
      kernelVersion: constants.KERNEL_V3_3,
    } as any);

    const kernelAccount = await createKernelAccount(publicClient as any, {
      entryPoint: ENTRYPOINT_V07,
      kernelVersion: constants.KERNEL_V3_3,
      plugins: {
        sudo: ecdsaValidator,
      },
    });

    addLog(`Kernel account address: ${kernelAccount.address}`);

    if (
      kernelAccount.address.toLowerCase() !==
      preparedUserOp.sender.toLowerCase()
    ) {
      throw new Error(
        [
          "Kernel account address does not match prepared userOp.sender.",
          `kernelAccount.address = ${kernelAccount.address}`,
          `preparedUserOp.sender = ${preparedUserOp.sender}`,
        ].join("\n")
      );
    }

    const kernelClient = createKernelAccountClient({
      account: kernelAccount,
      chain: currentChain.chain,
      bundlerTransport: http(currentChain.bundlerRpcUrl),
    });

    addLog("Signing ONLY the prepared userOp signature ...");

    const signInput = {
  sender: preparedUserOp.sender,
  nonce: stringToBigInt(preparedUserOp.nonce),
  callData: preparedUserOp.callData,

  maxFeePerGas: stringToBigInt(preparedUserOp.maxFeePerGas),
  maxPriorityFeePerGas: stringToBigInt(preparedUserOp.maxPriorityFeePerGas),

  callGasLimit: stringToBigInt(preparedUserOp.callGasLimit),
  verificationGasLimit: stringToBigInt(preparedUserOp.verificationGasLimit),
  preVerificationGas: stringToBigInt(preparedUserOp.preVerificationGas),

  paymaster: preparedUserOp.paymaster,
  paymasterVerificationGasLimit: stringToBigInt(
    preparedUserOp.paymasterVerificationGasLimit
  ),
  paymasterPostOpGasLimit: stringToBigInt(
    preparedUserOp.paymasterPostOpGasLimit
  ),
  paymasterData: preparedUserOp.paymasterData,

  factory: preparedUserOp.factory,
  factoryData: preparedUserOp.factoryData,

  authorization: preparedUserOp.authorization,
    };
    
    console.log("signInput =", signInput);

const signResult: any = await kernelClient.signUserOperation(signInput as any);

    const rawSignature =
  typeof signResult === "string"
    ? signResult
    : signResult?.signature;

if (
  !rawSignature ||
  typeof rawSignature !== "string" ||
  !rawSignature.startsWith("0x")
) {
  throw new Error("Failed to extract a valid hex signature from signUserOperation result.");
}

const signature = rawSignature as `0x${string}`;

const signed: PreparedUserOp = {
  ...preparedUserOp,
  signature,
};

    setSignedUserOp(signed);
    addLog("MetaMask sign success.");
  } catch (error: any) {
    console.error("handleSign error:", error);
    addLog(`Sign error: ${error?.message || String(error)}`);
  } finally {
    setLoadingSign(false);
  }
  }
  
  function stringToBigInt(value?: string) {
  if (value === undefined || value === null || value === "") return undefined;
  return BigInt(value);
}

async function handleSubmit() {
  try {
    if (!API_KEY) {
      throw new Error("Missing NEXT_PUBLIC_API_KEY in .env.local");
    }

    setLoadingSubmit(true);

    if (!signedUserOp) {
      throw new Error("Please sign first.");
    }

    addLog("Calling /sponsorships/submit ...");

    const {
      account,
      client,
      entryPoint,
      authorization,
      ...cleanUserOp
    } = signedUserOp as any;

    const res = await fetch(`${API_BASE_URL}/sponsorships/submit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": API_KEY,
      },
      body: JSON.stringify(
        {
          chainId: currentChain.chainId,
          signedUserOp: cleanUserOp,
        },
        (_, value) => (typeof value === "bigint" ? value.toString() : value)
      ),
    });

    const text = await res.text();

    if (!res.ok) {
      throw new Error(`Submit failed: ${text}`);
    }

    const json: SubmitResponse = JSON.parse(text);

    if (json.error) {
      throw new Error(json.error);
    }

    setUserOpHash(json.userOpHash || "");
setTxHash(json.txHash || "");

if (signedUserOp?.nonce) {
  setLastSubmittedNonce(signedUserOp.nonce);
  addLog(`Last submitted nonce = ${signedUserOp.nonce}`);
}

addLog(`Submit success. userOpHash=${json.userOpHash}`);
addLog(`Submit success. txHash=${json.txHash}`);
  } catch (error: any) {
    console.error("handleSubmit error:", error);
    addLog(`Submit error: ${error?.message || String(error)}`);
  } finally {
    setLoadingSubmit(false);
  }
}

  return (
    <main
      style={{
        maxWidth: 980,
        margin: "0 auto",
        padding: 24,
        fontFamily: "Arial, sans-serif",
      }}
    >
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 20 }}>
        Gas Sponsorship Demo
      </h1>

      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 12,
          padding: 16,
          marginBottom: 20,
        }}
      >
        <h2 style={{ fontSize: 20, marginBottom: 12 }}>1. blockchain selection</h2>

        <div style={{ marginBottom: 16 }}>
          <label>
            blockchain:
            <select
              value={selectedChain}
              onChange={(e) => {
  const nextChainKey = e.target.value;
  setSelectedChain(nextChainKey);
  resetFlowAfterChainChange(nextChainKey);
}}
              style={{ marginLeft: 8, padding: 6 }}
            >
              {Object.values(CHAINS).map((chain) => (
                <option key={chain.key} value={chain.key}>
                  {chain.label} (ID: {chain.chainId})
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 12,
          padding: 16,
          marginBottom: 20,
        }}
      >
        <h2 style={{ fontSize: 20, marginBottom: 12 }}>2. Wallet</h2>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <button
            onClick={connectMetaMask}
            disabled={loadingConnect}
            style={{ padding: "10px 14px", cursor: "pointer" }}
          >
            {loadingConnect ? "Connecting..." : "Connect MetaMask"}
          </button>

          <button
            onClick={handleDeriveSender}
            disabled={loadingDeriveSender || !walletAddress}
            style={{ padding: "10px 14px", cursor: "pointer" }}
          >
            {loadingDeriveSender ? "Deriving..." : "Derive Sender"}
          </button>
        </div>

        <div style={{ marginTop: 12 }}>
          <strong>Current Chain:</strong>{" "}
          {currentChain.label} (ID: {currentChain.chainId})
        </div>

        <div style={{ marginTop: 12 }}>
          <strong>Connected Address:</strong>{" "}
          {walletAddress || "Not connected"}
        </div>

        <div style={{ marginTop: 12 }}>
          <strong>Smart Account Sender:</strong>{" "}
          {sender || "Not derived"}
        </div>
      </div>

      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 12,
          padding: 16,
          marginBottom: 20,
        }}
      >
        <h2 style={{ fontSize: 20, marginBottom: 12 }}>3. Prepare Inputs</h2>

        <div style={{ marginBottom: 12 }}>
          <label>
            Type:
            <select
              value={type}
              onChange={(e) => {
  setType(e.target.value as SponsorshipType);
  setPreparedUserOp(null);
  setSignedUserOp(null);
  setUserOpHash("");
  setTxHash("");
  addLog(`Sponsorship type changed to ${e.target.value}. Cleared prepared/signed state.`);
}}
              style={{ marginLeft: 8, padding: 6 }}
            >
              <option value="verifying">verifying</option>
              <option value="erc20">erc20</option>
            </select>
          </label>
        </div>

        <div style={{ display: "grid", gap: 12 }}>
          <label>
            To
            <input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="0x..."
              style={{ width: "100%", padding: 10, marginTop: 6 }}
            />
          </label>

          <label>
            Data
            <textarea
              value={data}
              onChange={(e) => setData(e.target.value)}
              placeholder="0x..."
              rows={6}
              style={{ width: "100%", padding: 10, marginTop: 6 }}
            />
          </label>

          <label>
            Value
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="0x0"
              style={{ width: "100%", padding: 10, marginTop: 6 }}
            />
          </label>
        </div>

        <div style={{ marginTop: 16 }}>
          <button
            onClick={handlePrepare}
            disabled={loadingPrepare || !walletAddress || !sender}
            style={{ padding: "10px 14px", cursor: "pointer" }}
          >
            {loadingPrepare ? "Preparing..." : "Prepare"}
          </button>
        </div>
      </div>

      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 12,
          padding: 16,
          marginBottom: 20,
        }}
      >
        <h2 style={{ fontSize: 20, marginBottom: 12 }}>4. Sign & Submit</h2>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
  {isBaseFirstDeployment && (
    <button
      onClick={handleDeployFirstBaseTx}
      disabled={loadingDeployFirstTx || !walletAddress || !sender}
      style={{ padding: "10px 14px", cursor: "pointer" }}
    >
      {loadingDeployFirstTx ? "Deploying..." : "Deploy Smart Account (Self-pay)"}
    </button>
  )}

  <button
    onClick={handleSign}
    disabled={loadingSign || !preparedUserOp || isBaseFirstDeployment}
    style={{ padding: "10px 14px", cursor: "pointer" }}
  >
    {loadingSign ? "Signing..." : "Sign with MetaMask"}
  </button>

  <button
    onClick={handleSubmit}
    disabled={loadingSubmit || !signedUserOp || isBaseFirstDeployment}
    style={{ padding: "10px 14px", cursor: "pointer" }}
  >
    {loadingSubmit ? "Submitting..." : "Submit"}
          </button>
          {isBaseFirstDeployment && (
  <div style={{ marginTop: 12, color: "#b45309", lineHeight: 1.6 }}>
    <strong>Base first transaction detected.</strong>
    <div>
      This account still has factory/factoryData, so the first tx should be
      sent without sponsor. After deployment is confirmed, click Derive Sender
      again. Once Factory / FactoryData disappear, use the normal sponsor flow.
    </div>
  </div>
)}
</div>

        <div style={{ marginTop: 16, lineHeight: 1.8 }}>
          <div>
            <strong>sender:</strong> {preparedUserOp?.sender || sender || "-"}
          </div>
          <div>
            <strong>nonce:</strong> {preparedUserOp?.nonce || "-"}
          </div>
          <div>
            <strong>userOpHash:</strong> {userOpHash || "-"}
          </div>
          <div>
            <strong>txHash:</strong> {txHash || "-"}
          </div>
        </div>
      </div>
      <div style={{ marginTop: 12 }}>
  <strong>Factory:</strong> {factory || "None"}
</div>

<div style={{ marginTop: 12 }}>
  <strong>Factory Data:</strong> {factoryData ? `${factoryData.slice(0, 42)}...` : "None"}
</div>

      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 12,
          padding: 16,
          marginBottom: 20,
        }}
      >
        <h2 style={{ fontSize: 20, marginBottom: 12 }}>Prepared UserOp</h2>
        <pre
          style={{
            background: "#f6f6f6",
            padding: 12,
            borderRadius: 8,
            overflowX: "auto",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {prettyPrepared || "No prepared userOp yet."}
        </pre>
      </div>

      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 12,
          padding: 16,
          marginBottom: 20,
        }}
      >
        <h2 style={{ fontSize: 20, marginBottom: 12 }}>Signed UserOp</h2>
        <pre
          style={{
            background: "#f6f6f6",
            padding: 12,
            borderRadius: 8,
            overflowX: "auto",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {prettySigned || "No signed userOp yet."}
        </pre>
      </div>

      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 12,
          padding: 16,
        }}
      >
        <h2 style={{ fontSize: 20, marginBottom: 12 }}>Status Logs</h2>
        <div
          style={{
            background: "#111",
            color: "#0f0",
            padding: 12,
            borderRadius: 8,
            minHeight: 180,
            fontFamily: "monospace",
            whiteSpace: "pre-wrap",
          }}
        >
          {logs.length > 0 ? logs.join("\n") : "No logs yet."}
        </div>
      </div>
    </main>
  );
}