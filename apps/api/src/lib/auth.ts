import { randomBytes } from "node:crypto";
import { verifyMessage } from "ethers";
import jwt from "jsonwebtoken";
import { config } from "./config.js";
import { pool } from "./db.js";

const NONCE_TTL_MS = 5 * 60_000;

export function isValidWalletAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

export function buildSignInMessage(address: string, nonce: string): string {
  return [
    "RecallRaid wants you to sign in with your wallet.",
    "",
    `Address: ${address.toLowerCase()}`,
    `Nonce: ${nonce}`,
    "",
    "This request will not trigger a blockchain transaction or cost any gas.",
  ].join("\n");
}

/**
 * Recovers the signer address from a signed message and confirms it matches
 * the claimed wallet address. Pure function (no I/O) so the signature-
 * verification math itself is unit-testable without a database.
 */
export function recoverAndMatch(message: string, signature: string, claimedAddress: string): boolean {
  let recovered: string;
  try {
    recovered = verifyMessage(message, signature);
  } catch {
    return false;
  }
  return recovered.toLowerCase() === claimedAddress.toLowerCase();
}

export function isNonceExpired(expiresAt: Date, now: Date = new Date()): boolean {
  return expiresAt.getTime() < now.getTime();
}

// --- Postgres-backed nonce lifecycle -----------------------------------
// Nonces live in Postgres (not process memory) because the API can run
// multiple Fly.io machines behind a load balancer; /auth/nonce and the
// follow-up /auth/verify may land on different machines.

export async function issueNonce(address: string): Promise<string> {
  const nonce = randomBytes(16).toString("hex");
  const expiresAt = new Date(Date.now() + NONCE_TTL_MS);
  const wallet = address.toLowerCase();
  await pool.query(
    `insert into users (wallet_address) values ($1)
     on conflict (wallet_address) do update set last_seen_at = now()`,
    [wallet],
  );
  await pool.query(
    `insert into login_nonces (wallet_address, nonce, expires_at, used)
     values ($1, $2, $3, false)
     on conflict (wallet_address) do update
       set nonce = excluded.nonce, expires_at = excluded.expires_at, used = false`,
    [wallet, nonce, expiresAt],
  );
  return nonce;
}

export async function verifySignedNonce(address: string, signature: string): Promise<boolean> {
  const wallet = address.toLowerCase();
  const { rows } = await pool.query(
    "select nonce, expires_at, used from login_nonces where wallet_address = $1",
    [wallet],
  );
  const entry = rows[0] as { nonce: string; expires_at: Date; used: boolean } | undefined;
  if (!entry || entry.used || isNonceExpired(new Date(entry.expires_at))) {
    return false;
  }
  const message = buildSignInMessage(wallet, entry.nonce);
  const ok = recoverAndMatch(message, signature, wallet);
  if (ok) {
    // One-time use — prevents signature replay against the same nonce.
    await pool.query("update login_nonces set used = true where wallet_address = $1", [wallet]);
    await pool.query("update users set last_seen_at = now() where wallet_address = $1", [wallet]);
  }
  return ok;
}

export interface SessionPayload {
  walletAddress: string;
}

export function signSession(payload: SessionPayload): string {
  return jwt.sign(payload, config.jwtSigningSecret, { expiresIn: "30d" });
}

export function verifySession(token: string): SessionPayload | null {
  try {
    return jwt.verify(token, config.jwtSigningSecret) as SessionPayload;
  } catch {
    return null;
  }
}
