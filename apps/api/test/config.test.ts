import { describe, expect, it } from "vitest";
import { parseCorsAllowedOrigins } from "../src/lib/cors-origins.js";

describe("CORS origin configuration", () => {
  it("parses comma-separated exact origins and removes duplicates", () => {
    expect(parseCorsAllowedOrigins(" https://app.example,https://archive.example, https://app.example "))
      .toEqual(["https://app.example", "https://archive.example"]);
  });

  it("uses the local development origin when unset or empty", () => {
    expect(parseCorsAllowedOrigins()).toEqual(["http://localhost:3000"]);
    expect(parseCorsAllowedOrigins(" , ")).toEqual(["http://localhost:3000"]);
  });
});
