import { describe, it, expect } from "vitest";
import { Wallet } from "ethers";
import { buildSignInMessage, recoverAndMatch, isValidWalletAddress, isNonceExpired } from "../src/lib/auth.js";

describe("isValidWalletAddress", () => {
  it("accepts a well-formed EVM address", () => {
    expect(isValidWalletAddress(Wallet.createRandom().address)).toBe(true);
  });

  it("rejects a too-short address", () => {
    expect(isValidWalletAddress("0x1234")).toBe(false);
  });

  it("rejects an address missing the 0x prefix", () => {
    expect(isValidWalletAddress("0000000000000000000000000000000000000AA")).toBe(false);
  });

  it("rejects non-hex characters", () => {
    expect(isValidWalletAddress("0xzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz")).toBe(false);
  });
});

describe("buildSignInMessage", () => {
  it("lower-cases the address and embeds the nonce", () => {
    const msg = buildSignInMessage("0xABCDEF0000000000000000000000000000000A", "deadbeef");
    expect(msg).toContain("Address: 0xabcdef0000000000000000000000000000000a");
    expect(msg).toContain("Nonce: deadbeef");
  });
});

describe("recoverAndMatch (signature verification)", () => {
  it("accepts a correctly signed message from the claimed address", async () => {
    const wallet = Wallet.createRandom();
    const nonce = "abc123";
    const message = buildSignInMessage(wallet.address, nonce);
    const signature = await wallet.signMessage(message);

    expect(recoverAndMatch(message, signature, wallet.address)).toBe(true);
  });

  it("rejects a signature from a different wallet than claimed", async () => {
    const signer = Wallet.createRandom();
    const impersonated = Wallet.createRandom();
    const nonce = "abc123";
    const message = buildSignInMessage(impersonated.address, nonce);
    const signature = await signer.signMessage(message);

    expect(recoverAndMatch(message, signature, impersonated.address)).toBe(false);
  });

  it("rejects a valid signature over a tampered message (nonce swap)", async () => {
    const wallet = Wallet.createRandom();
    const signedMessage = buildSignInMessage(wallet.address, "original-nonce");
    const signature = await wallet.signMessage(signedMessage);

    const tamperedMessage = buildSignInMessage(wallet.address, "different-nonce");
    expect(recoverAndMatch(tamperedMessage, signature, wallet.address)).toBe(false);
  });

  it("rejects a malformed signature instead of throwing", () => {
    expect(recoverAndMatch("some message", "0xnotasignature", "0x0000000000000000000000000000000000000A")).toBe(
      false,
    );
  });

  it("is case-insensitive when comparing the recovered address", async () => {
    const wallet = Wallet.createRandom();
    const message = buildSignInMessage(wallet.address, "n1");
    const signature = await wallet.signMessage(message);
    expect(recoverAndMatch(message, signature, wallet.address.toUpperCase())).toBe(true);
  });
});

describe("isNonceExpired", () => {
  it("treats a future expiry as not expired", () => {
    const future = new Date(Date.now() + 60_000);
    expect(isNonceExpired(future)).toBe(false);
  });

  it("treats a past expiry as expired", () => {
    const past = new Date(Date.now() - 60_000);
    expect(isNonceExpired(past)).toBe(true);
  });
});
