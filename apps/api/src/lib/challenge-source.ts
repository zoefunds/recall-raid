import { createHash } from "node:crypto";
import { badGateway, badRequest } from "./http-errors.js";

export const AUTHORITATIVE_RECALL_HOSTS = new Set([
  "cpsc.gov", "www.cpsc.gov",
  "nhtsa.gov", "www.nhtsa.gov",
  "fda.gov", "www.fda.gov",
  "fsis.usda.gov",
  "recalls.gov", "www.recalls.gov",
  "ec.europa.eu",
  "product-recalls.campaign.gov.uk",
  "www.gov.uk",
  "healthycanadians.gc.ca",
  "recalls-rappels.canada.ca",
  "productsafety.gov.au",
]);

export const MAX_CHALLENGE_SOURCE_BYTES = 10 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 15_000;

export function validateChallengeSourceUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw badRequest("A valid official regulator URL is required");
  }
  if (url.protocol !== "https:" || url.username || url.password || !AUTHORITATIVE_RECALL_HOSTS.has(url.hostname.toLowerCase())) {
    throw badRequest("Challenge evidence must use HTTPS on an allowlisted regulator domain");
  }
  url.hash = "";
  return url;
}

export async function fetchChallengeSourceDigest(value: string): Promise<{ url: string; sha256: string; byteLength: number }> {
  let url = validateChallengeSourceUrl(value);
  let response: Response | undefined;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    try {
      response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    } catch {
      throw badGateway("Could not fetch the regulator source");
    }
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get("location");
    if (!location || redirects === MAX_REDIRECTS) throw badRequest("Regulator source redirected too many times");
    const previous = response;
    try {
      url = validateChallengeSourceUrl(new URL(location, url).toString());
    } catch (error) {
      await previous.body?.cancel();
      throw error;
    }
    await previous.body?.cancel();
  }
  if (!response?.ok) throw badRequest(`Regulator source returned HTTP ${response?.status ?? "no response"}`);
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > MAX_CHALLENGE_SOURCE_BYTES) throw badRequest("Regulator source exceeds the 10 MB verification limit");
  if (!response.body) throw badRequest("Regulator source returned no content");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > MAX_CHALLENGE_SOURCE_BYTES) {
      await reader.cancel();
      throw badRequest("Regulator source exceeds the 10 MB verification limit");
    }
    chunks.push(value);
  }
  const sha256 = createHash("sha256").update(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)))).digest("hex");
  return { url: url.toString(), sha256, byteLength };
}
