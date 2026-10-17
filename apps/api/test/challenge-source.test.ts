import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { fetchChallengeSourceDigest, validateChallengeSourceUrl } from "../src/lib/challenge-source.js";

afterEach(() => vi.unstubAllGlobals());

describe("challenge regulator source URL validation", () => {
  it("accepts an allowlisted HTTPS regulator URL and removes fragments", () => {
    expect(validateChallengeSourceUrl("https://www.cpsc.gov/Recalls/123#details").toString())
      .toBe("https://www.cpsc.gov/Recalls/123");
  });

  it("rejects insecure schemes, lookalike hosts, credentials, and unlisted sources", () => {
    for (const url of [
      "http://www.cpsc.gov/Recalls/123",
      "https://www.cpsc.gov.attacker.example/Recalls/123",
      "https://cpsc.gov@attacker.example/Recalls/123",
      "https://example.com/recall",
    ]) {
      expect(() => validateChallengeSourceUrl(url)).toThrow(/HTTPS on an allowlisted regulator domain/);
    }
  });

  it("hashes official source bytes and only follows redirects to another allowlisted HTTPS host", async () => {
    const bytes = Buffer.from("official recall notice");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://www.cpsc.gov/notice" } }))
      .mockResolvedValueOnce(new Response(bytes));
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchChallengeSourceDigest("https://cpsc.gov/notice");
    expect(result).toEqual({
      url: "https://www.cpsc.gov/notice",
      sha256: createHash("sha256").update(bytes).digest("hex"),
      byteLength: bytes.length,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects redirects to non-regulator hosts without fetching them", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, {
      status: 302,
      headers: { location: "https://attacker.example/notice" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchChallengeSourceDigest("https://cpsc.gov/notice"))
      .rejects.toThrow(/HTTPS on an allowlisted regulator domain/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
