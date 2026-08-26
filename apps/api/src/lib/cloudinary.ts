import { createHash, randomUUID } from "node:crypto";
import { config, assertCloudinaryConfigured } from "./config.js";

// Cloudinary uses a signed-upload pattern rather than S3-style presigned
// PUT URLs: the backend signs a small set of parameters (never the file
// itself, which never transits this API), and the frontend POSTs the file
// as multipart/form-data directly to Cloudinary's upload endpoint along
// with those signed fields. Cloudinary then returns the final asset URL
// (`secure_url`) in its own response — the backend never learns the final
// URL until the frontend reports it back via /evidence/:id/sync.

const ALLOWED_CONTENT_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};
// NOTE: do not add "text/html" here for a fetchable "listing page" use
// case — Cloudinary forces `Content-Disposition: attachment` on every raw
// HTML upload (a deliberate, non-configurable anti-XSS policy for assets
// served from its shared res.cloudinary.com domain), which makes any
// browser-based fetch (including GenVM's `gl.nondet.web.render`) treat it
// as a file download instead of a page to render — confirmed live: this
// was tried for the seller-bond listing-verification test page and every
// `verify_seller_bond_listing` call against it returned `found: False`/
// disagreed inconsistently, even though the code was genuinely present in
// the uploaded body. See `GET /seller-bonds/:id/demo-listing` instead for
// a self-hosted page that doesn't have this problem.

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // 15 MB — generous for a phone photo/PDF, small enough to bound abuse

export class UploadValidationError extends Error {}

export interface SignedUpload {
  uploadUrl: string;
  publicId: string;
  fields: {
    api_key: string;
    timestamp: string;
    signature: string;
    public_id: string;
    folder: string;
  };
  maxUploadBytes: number;
  expiresInSeconds: number;
}

/**
 * Cloudinary's signature algorithm: take every parameter that will be sent
 * in the upload request EXCEPT `file`, `cloud_name`, `resource_type`, and
 * `api_key` itself, sort them alphabetically by key, join as
 * `key=value&key=value...`, append the API secret directly (no separator),
 * then SHA-1 the result. This is Cloudinary's documented algorithm, not
 * guessed — see https://cloudinary.com/documentation/upload_images#generating_authentication_signatures.
 */
function signParams(params: Record<string, string>, apiSecret: string): string {
  const toSign = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");
  return createHash("sha1").update(toSign + apiSecret).digest("hex");
}

export function generateSignedUpload(params: {
  investigationId: number;
  contentType: string;
  declaredSizeBytes: number;
  fileName?: string;
}): SignedUpload {
  assertCloudinaryConfigured();
  const { investigationId, contentType, declaredSizeBytes, fileName } = params;

  const ext = ALLOWED_CONTENT_TYPES[contentType.toLowerCase()];
  if (!ext) {
    throw new UploadValidationError(
      `Unsupported content type "${contentType}". Allowed: ${Object.keys(ALLOWED_CONTENT_TYPES).join(", ")}`,
    );
  }
  if (fileName) {
    const lowerName = fileName.toLowerCase();
    const validExt = [".jpg", ".jpeg", ".png", ".webp", ".pdf"].some((e) => lowerName.endsWith(e));
    if (!validExt) {
      throw new UploadValidationError("File extension does not match an allowed evidence type.");
    }
  }
  if (!Number.isFinite(declaredSizeBytes) || declaredSizeBytes <= 0) {
    throw new UploadValidationError("declaredSizeBytes must be a positive number.");
  }
  if (declaredSizeBytes > MAX_UPLOAD_BYTES) {
    throw new UploadValidationError(`File exceeds the ${MAX_UPLOAD_BYTES} byte limit.`);
  }
  if (!Number.isInteger(investigationId) || investigationId <= 0) {
    throw new UploadValidationError("investigationId must be a positive integer.");
  }

  const folder = `${config.cloudinary.uploadFolder}/${investigationId}`;
  const publicId = randomUUID();
  const timestamp = Math.floor(Date.now() / 1000).toString();

  // Only parameters that are actually sent alongside the file need to be
  // signed. `folder` and `public_id` are the only ones this contract
  // needs, kept deliberately minimal — every extra signed param is one
  // more thing that must match exactly between signature and request.
  const signature = signParams({ folder, public_id: publicId, timestamp }, config.cloudinary.apiSecret);

  return {
    uploadUrl: `https://api.cloudinary.com/v1_1/${config.cloudinary.cloudName}/auto/upload`,
    publicId,
    fields: {
      api_key: config.cloudinary.apiKey,
      timestamp,
      signature,
      public_id: publicId,
      folder,
    },
    maxUploadBytes: MAX_UPLOAD_BYTES,
    expiresInSeconds: 300,
  };
}
