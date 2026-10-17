export function parseCorsAllowedOrigins(value?: string): string[] {
  const configured = value?.split(",").map((origin) => origin.trim()).filter(Boolean) ?? [];
  return configured.length > 0 ? [...new Set(configured)] : ["http://localhost:3000"];
}
