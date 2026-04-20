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
import { polygon } from "viem/chains";

import {
  constants,
  createKernelAccount,
  createKernelAccountClient,
} from "@zerodev/sdk";
import { signerToEcdsaValidator } from "@zerodev/ecdsa-validator";

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
  unsignedUserOp: {
    userOp: PreparedUserOp;
    kernelAccountAddress?: string;
  };
};

type SubmitResponse = {
  userOpHash: string;
  txHash: string;
  error?: string;
};

const CHAIN = polygon;

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";

const API_KEY = process.env.NEXT_PUBLIC_API_KEY || "";

const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL || "https://polygon-rpc.com";

const BUNDLER_RPC_URL =
  process.env.NEXT_PUBLIC_BUNDLER_RPC_URL || "";

export default function Page() {
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
  const [txHash, setTxHash] = useState("");

  const [loadingConnect, setLoadingConnect] = useState(false);
  const [loadingDeriveSender, setLoadingDeriveSender] = useState(false);
  const [loadingPrepare, setLoadingPrepare] = useState(false);
  const [loadingSign, setLoadingSign] = useState(false);
  const [loadingSubmit, setLoadingSubmit] = useState(false);

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
}

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
        chain: CHAIN,
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
      chain: CHAIN,
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
      chain: CHAIN,
      transport: http(RPC_URL),
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
  chain: CHAIN,
  transport: custom(window.ethereum),
});

const [selectedAddress] = await walletClient.requestAddresses();

if (!selectedAddress) {
  throw new Error("No MetaMask account selected.");
}

if (selectedAddress.toLowerCase() !== walletAddress.toLowerCase()) {
  throw new Error("MetaMask selected account does not match connected account.");
}

const publicClient = createPublicClient({
  chain: CHAIN,
  transport: http(RPC_URL),
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

const encoded = await kernelAccount.encodeCalls([
  {
    to: to as Address,
    data: (data || "0x") as Hex,
    value: BigInt(value || "0x0"),
  },
]);

setEncodedCallData(encoded);
console.log("encodedCallData =", encoded);
addLog(`Encoded callData: ${encoded.slice(0, 42)}...`);

      addLog("Calling /sponsorships/prepare ...");
      
      const res = await fetch(`${API_BASE_URL}/sponsorships/prepare`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-KEY": API_KEY,
        },
        
        body: JSON.stringify({
  from: walletAddress,
  sender,
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

const json: PrepareResponse = JSON.parse(rawText);

      if (!json?.unsignedUserOp?.userOp) {
        throw new Error("Prepare response missing unsignedUserOp.userOp");
      }

      setPreparedUserOp( json.unsignedUserOp.userOp );
      console.log("input to =", to);
console.log("input data =", data);
console.log("input value =", value);
console.log("encodedCallData sent =", encoded);
console.log("prepared userOp =", json.unsignedUserOp.userOp);
console.log("prepared userOp.callData =", json.unsignedUserOp.userOp.callData);

      addLog("Prepare success.");
      addLog(`Prepared sender: ${json.unsignedUserOp.userOp.sender}`);
      addLog(`Prepared nonce: ${json.unsignedUserOp.userOp.nonce}`);
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

    if (!BUNDLER_RPC_URL) {
      throw new Error("Missing NEXT_PUBLIC_BUNDLER_RPC_URL");
    }

    addLog("Creating viem wallet client from MetaMask ...");

    const walletClient = createWalletClient({
      chain: CHAIN,
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
      chain: CHAIN,
      transport: http(RPC_URL),
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
      chain: CHAIN,
      bundlerTransport: http(BUNDLER_RPC_URL),
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

    const body = JSON.stringify(
      {
        signedUserOp: cleanUserOp,
      },
      (_, value) => (typeof value === "bigint" ? value.toString() : value)
    );

    const res = await fetch(`${API_BASE_URL}/sponsorships/submit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": API_KEY,
      },
      body,
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
        <h2 style={{ fontSize: 20, marginBottom: 12 }}>1. Wallet</h2>

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
        <h2 style={{ fontSize: 20, marginBottom: 12 }}>2. Prepare Inputs</h2>

        <div style={{ marginBottom: 12 }}>
          <label>
            Type:
            <select
              value={type}
              onChange={(e) => setType(e.target.value as SponsorshipType)}
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
        <h2 style={{ fontSize: 20, marginBottom: 12 }}>3. Sign & Submit</h2>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <button
            onClick={handleSign}
            disabled={loadingSign || !preparedUserOp}
            style={{ padding: "10px 14px", cursor: "pointer" }}
          >
            {loadingSign ? "Signing..." : "Sign with MetaMask"}
          </button>

          <button
            onClick={handleSubmit}
            disabled={loadingSubmit || !signedUserOp}
            style={{ padding: "10px 14px", cursor: "pointer" }}
          >
            {loadingSubmit ? "Submitting..." : "Submit"}
          </button>
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