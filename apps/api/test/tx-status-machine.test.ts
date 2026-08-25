import { describe, it, expect } from "vitest";
import { canTransition, isTerminal, isValidTxKind, isValidTxStatus } from "../src/lib/tx-status-machine.js";

describe("canTransition", () => {
  it("allows the full happy-path lifecycle", () => {
    expect(canTransition("idle", "preparing")).toBe(true);
    expect(canTransition("preparing", "submitted")).toBe(true);
    expect(canTransition("submitted", "pending")).toBe(true);
    expect(canTransition("pending", "confirmed")).toBe(true);
  });

  it("allows submitted to go straight to confirmed (fast finality)", () => {
    expect(canTransition("submitted", "confirmed")).toBe(true);
  });

  it("allows idle to jump straight to submitted (client skipped optimistic preparing state)", () => {
    expect(canTransition("idle", "submitted")).toBe(true);
  });

  it("allows a duplicate report of the same state (idempotent polling)", () => {
    expect(canTransition("pending", "pending")).toBe(true);
    expect(canTransition("confirmed", "confirmed")).toBe(true);
  });

  it("rejects moving backward from pending to submitted", () => {
    expect(canTransition("pending", "submitted")).toBe(false);
  });

  it("rejects any transition out of a terminal state", () => {
    expect(canTransition("confirmed", "pending")).toBe(false);
    expect(canTransition("failed", "pending")).toBe(false);
    expect(canTransition("timeout", "confirmed")).toBe(false);
  });

  it("rejects skipping straight from idle to confirmed", () => {
    expect(canTransition("idle", "confirmed")).toBe(false);
  });

  it("allows preparing to fail directly (wallet rejection before broadcast)", () => {
    expect(canTransition("preparing", "failed")).toBe(true);
  });

  it("allows pending to time out", () => {
    expect(canTransition("pending", "timeout")).toBe(true);
  });
});

describe("isTerminal", () => {
  it("flags confirmed/failed/timeout as terminal", () => {
    expect(isTerminal("confirmed")).toBe(true);
    expect(isTerminal("failed")).toBe(true);
    expect(isTerminal("timeout")).toBe(true);
  });

  it("does not flag idle/preparing/submitted/pending as terminal", () => {
    expect(isTerminal("idle")).toBe(false);
    expect(isTerminal("preparing")).toBe(false);
    expect(isTerminal("submitted")).toBe(false);
    expect(isTerminal("pending")).toBe(false);
  });
});

describe("isValidTxKind / isValidTxStatus", () => {
  it("accepts every write method named in the contract", () => {
    for (const kind of [
      "submit_investigation",
      "add_evidence",
      "open_challenge",
      "settle_investigation",
      "withdraw",
      "create_seller_bond",
    ]) {
      expect(isValidTxKind(kind)).toBe(true);
    }
  });

  it("rejects an unknown kind", () => {
    expect(isValidTxKind("do_something_sneaky")).toBe(false);
  });

  it("rejects an unknown status", () => {
    expect(isValidTxStatus("totally_done")).toBe(false);
  });
});
