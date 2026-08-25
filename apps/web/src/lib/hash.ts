/** Client-side sha256 content hashing for evidence files, using the
 * browser's native SubtleCrypto — no extra dependency needed. The result
 * is stored alongside the R2 URL and passed to the contract's
 * `add_evidence(content_hash, url, ...)` so integrity is anchored on-chain
 * without ever putting the file itself on-chain. */
export async function sha256Hex(file: File | Blob): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
