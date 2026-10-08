import "dotenv/config";

function required(name: string, fallback?: string): string {
  const configured = process.env[name]?.trim();
  if (configured) return configured;
  // Development may use the explicitly documented local fallback. In
  // production an unset *or empty* value must stop startup: jsonwebtoken
  // otherwise throws only after a user has signed a wallet nonce, producing
  // a misleading frontend authentication failure.
  if (fallback !== undefined && process.env.NODE_ENV !== "production") {
    return fallback;
  }
  if (!configured) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return configured;
}

// Variable names below are copied verbatim from the repo-root .env.example —
// keep them in sync with that file rather than inventing new names here.
export const config = {
  env: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 8080),
  databaseUrl: required("DATABASE_URL"),
  corsAllowedOrigin: process.env.CORS_ALLOWED_ORIGIN ?? "http://localhost:3000",
  jwtSigningSecret: required("JWT_SIGNING_SECRET", "dev-only-insecure-secret-change-me"),

  genlayer: {
    rpcUrl: process.env.GENLAYER_RPC_URL ?? "",
    contractAddress: process.env.GENLAYER_CONTRACT_ADDRESS ?? "",
    chain: process.env.NEXT_PUBLIC_GENLAYER_CHAIN ?? "studionet",
  },

  baseSepolia: {
    rpcUrl: process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org",
    chainId: Number(process.env.BASE_SEPOLIA_CHAIN_ID ?? 84532),
    usdcAddress:
      process.env.BASE_SEPOLIA_USDC_ADDRESS ?? "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    escrowAddress: process.env.RECALLRAID_ESCROW_ADDRESS ?? "",
    relayerPrivateKey: process.env.BASE_SEPOLIA_RELAYER_PRIVATE_KEY ?? "",
  },

  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME ?? "",
    apiKey: process.env.CLOUDINARY_API_KEY ?? "",
    apiSecret: process.env.CLOUDINARY_API_SECRET ?? "",
    uploadFolder: process.env.CLOUDINARY_UPLOAD_FOLDER ?? "recallraid-evidence",
  },
};

export function assertGenlayerConfigured(): void {
  if (!config.genlayer.contractAddress) {
    throw new Error("GENLAYER_CONTRACT_ADDRESS is not configured — the contract must be deployed first.");
  }
}

export function assertCloudinaryConfigured(): void {
  if (!config.cloudinary.cloudName || !config.cloudinary.apiKey || !config.cloudinary.apiSecret) {
    throw new Error(
      "Cloudinary credentials are not configured (CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET).",
    );
  }
}
