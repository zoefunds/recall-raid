import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import solc from "solc";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, "RecallRaidEscrow.sol"), "utf8");
const output = JSON.parse(solc.compile(JSON.stringify({
  language: "Solidity",
  sources: { "RecallRaidEscrow.sol": { content: source } },
  settings: { optimizer: { enabled: true, runs: 200 }, outputSelection: { "*": { "*": ["abi"] } } },
})));
for (const item of output.errors ?? []) console[item.severity === "error" ? "error" : "warn"](item.formattedMessage);
if ((output.errors ?? []).some((item) => item.severity === "error")) process.exit(1);
console.log("RecallRaidEscrow.sol compiled successfully");
