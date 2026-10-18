import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import solc from "solc";
import { ethers } from "ethers";

const here = path.dirname(fileURLToPath(import.meta.url));
const address = process.env.RECALLRAID_ESCROW_ADDRESS;
const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
if (!address || !ethers.isAddress(address)) throw new Error("Set RECALLRAID_ESCROW_ADDRESS to the deployed escrow address");

const source = fs.readFileSync(path.join(here, "RecallRaidEscrow.sol"), "utf8");
const expectedUsdc = process.env.BASE_SEPOLIA_USDC_ADDRESS || "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const expectedRelayer = process.env.RELAYER_ADDRESS
  || (process.env.BASE_SEPOLIA_RELAYER_PRIVATE_KEY ? new ethers.Wallet(process.env.BASE_SEPOLIA_RELAYER_PRIVATE_KEY).address : undefined);
const expectedDecisionSigner = process.env.DECISION_SIGNER_ADDRESS
  || (process.env.BASE_SEPOLIA_DECISION_SIGNER_PRIVATE_KEY ? new ethers.Wallet(process.env.BASE_SEPOLIA_DECISION_SIGNER_PRIVATE_KEY).address : undefined);
if (!expectedRelayer || !ethers.isAddress(expectedRelayer) || expectedRelayer === ethers.ZeroAddress) throw new Error("Set RELAYER_ADDRESS or BASE_SEPOLIA_RELAYER_PRIVATE_KEY for the expected deployed relayer");
if (!expectedDecisionSigner || !ethers.isAddress(expectedDecisionSigner) || expectedDecisionSigner === ethers.ZeroAddress) throw new Error("Set DECISION_SIGNER_ADDRESS or BASE_SEPOLIA_DECISION_SIGNER_PRIVATE_KEY for the expected deployed decision signer");
if (!ethers.isAddress(expectedUsdc)) throw new Error("BASE_SEPOLIA_USDC_ADDRESS must be a valid address");
if (process.env.DEPLOYER_ADDRESS && !ethers.isAddress(process.env.DEPLOYER_ADDRESS)) throw new Error("DEPLOYER_ADDRESS must be a valid EVM address");
const output = JSON.parse(solc.compile(JSON.stringify({
  language: "Solidity",
  sources: { "RecallRaidEscrow.sol": { content: source } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    viaIR: true,
    outputSelection: { "*": { "*": ["abi", "evm.deployedBytecode.object", "evm.deployedBytecode.immutableReferences"] } },
  },
})));
for (const diagnostic of output.errors ?? []) {
  const destination = diagnostic.severity === "error" ? console.error : console.warn;
  destination(diagnostic.formattedMessage);
}
if ((output.errors ?? []).some((item) => item.severity === "error")) process.exit(1);

const artifact = output.contracts["RecallRaidEscrow.sol"]?.RecallRaidEscrow;
if (!artifact) throw new Error("Solidity compiler did not produce the escrow artifact");
const expected = artifact.evm.deployedBytecode.object.toLowerCase();
const immutableReferences = Object.values(artifact.evm.deployedBytecode.immutableReferences ?? {}).flat();
const maskImmutables = (bytecode) => {
  const chars = bytecode.split("");
  for (const { start, length } of immutableReferences) {
    for (let i = start * 2; i < (start + length) * 2; i++) chars[i] = "0";
  }
  return chars.join("");
};

const provider = new ethers.JsonRpcProvider(rpcUrl);
const network = await provider.getNetwork();
if (network.chainId !== 84532n) throw new Error(`Refusing verification: RPC chain id ${network.chainId} is not Base Sepolia (84532)`);
const deployed = (await provider.getCode(address)).slice(2).toLowerCase();
if (!deployed) throw new Error("No contract bytecode found at the configured address");
if (maskImmutables(deployed) !== maskImmutables(expected)) {
  throw new Error("Deployed runtime bytecode does not match the current RecallRaidEscrow.sol build");
}

const escrow = new ethers.Contract(address, artifact.abi, provider);
const usdc = await escrow.usdc();
if (expectedUsdc && usdc.toLowerCase() !== expectedUsdc.toLowerCase()) {
  throw new Error(`Deployed escrow USDC ${usdc} does not match BASE_SEPOLIA_USDC_ADDRESS`);
}
const [relayer, decisionSigner, owner] = await Promise.all([
  escrow.relayer(),
  escrow.decisionSigner(),
  escrow.owner(),
]);
if (relayer.toLowerCase() !== expectedRelayer.toLowerCase()) throw new Error(`Deployed relayer ${relayer} does not match RELAYER_ADDRESS`);
if (decisionSigner.toLowerCase() !== expectedDecisionSigner.toLowerCase()) throw new Error(`Deployed decision signer ${decisionSigner} does not match DECISION_SIGNER_ADDRESS`);
const expectedOwner = process.env.DEPLOYER_ADDRESS;
if (expectedOwner && owner.toLowerCase() !== expectedOwner.toLowerCase()) throw new Error(`Deployed owner ${owner} does not match DEPLOYER_ADDRESS`);
const [basisPointDenominator, challengeOverturnBonusBps, verificationBlock] = await Promise.all([
  escrow.BPS_DENOMINATOR(),
  escrow.CHALLENGE_OVERTURN_BONUS_BPS(),
  provider.getBlockNumber(),
]);
if (basisPointDenominator !== 10_000n) throw new Error(`Unexpected deployed BPS denominator ${basisPointDenominator}`);
if (challengeOverturnBonusBps !== 1_500n) throw new Error(`Unexpected deployed overturn bonus ${challengeOverturnBonusBps}`);
const maskedCompiled = maskImmutables(expected);
const maskedDeployed = maskImmutables(deployed);
console.log(JSON.stringify({
  verified: true,
  equivalence: "immutable-aware byte-for-byte runtime match",
  network: "Base Sepolia",
  chainId: Number(network.chainId),
  address: ethers.getAddress(address),
  verificationBlock,
  runtimeByteLength: deployed.length / 2,
  runtimeBytecodeHash: ethers.keccak256(`0x${deployed}`),
  compiledRuntimeBytecodeHash: ethers.keccak256(`0x${expected}`),
  maskedRuntimeBytecodeHash: ethers.keccak256(`0x${maskedDeployed}`),
  maskedCompiledRuntimeBytecodeHash: ethers.keccak256(`0x${maskedCompiled}`),
  sourceHash: ethers.keccak256(ethers.toUtf8Bytes(source)),
  compiler: solc.version(),
  optimizerRuns: 200,
  viaIR: true,
  immutableReferences,
  owner,
  relayer,
  decisionSigner,
  usdc,
  basisPointDenominator: basisPointDenominator.toString(),
  challengeOverturnBonusBps: challengeOverturnBonusBps.toString(),
}, null, 2));
