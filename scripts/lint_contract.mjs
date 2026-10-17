#!/usr/bin/env node
// Select the cached GenVM bundle that contains the contract's pinned
// py-genlayer dependency. The user's explicit GENVM_VERSION still wins.
import { spawnSync } from "node:child_process";

const version = process.env.GENVM_VERSION || "v0.3.0-rc7";
const env = { ...process.env, GENVM_VERSION: version };
const result = spawnSync(
  "genvm-lint",
  ["check", "contracts/recallraid_contract.py", "--json"],
  { env, stdio: "inherit", shell: process.platform === "win32" },
);

if (result.error) {
  console.error(`Could not run genvm-lint: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
