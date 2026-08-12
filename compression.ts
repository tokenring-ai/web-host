/**
 * Content-negotiation helpers for static-file response compression.
 *
 * Maps config algorithm names (`br`, `gzip`) to:
 * - Content-Encoding header values
 * - Bun CompressionStream format names (`brotli`, `gzip`)
 */

export type CompressAlgorithm = "br" | "gzip";

export type CompressionChoice = {
  /** Value for the Content-Encoding response header */
  contentEncoding: "br" | "gzip";
  /** Format accepted by `new CompressionStream(...)` */
  streamFormat: "brotli" | "gzip";
};

const ALGORITHM_TO_CHOICE: Record<CompressAlgorithm, CompressionChoice> = {
  br: { contentEncoding: "br", streamFormat: "brotli" },
  gzip: { contentEncoding: "gzip", streamFormat: "gzip" },
};

/** Extensions that typically benefit from compression (text-ish / compressible binary). */
const COMPRESSIBLE_EXTENSIONS = new Set([
  ".css",
  ".csv",
  ".htm",
  ".html",
  ".js",
  ".json",
  ".map",
  ".mjs",
  ".cjs",
  ".md",
  ".svg",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
  ".ts",
  ".tsx",
  ".jsx",
]);

export function isCompressiblePath(filePath: string): boolean {
  const dot = filePath.lastIndexOf(".");
  if (dot < 0) return false;
  const ext = filePath.slice(dot).toLowerCase();
  return COMPRESSIBLE_EXTENSIONS.has(ext);
}

/**
 * Pick the best compression algorithm supported by both the client
 * (`Accept-Encoding`) and the configured algorithm preference list.
 * Preference order is the order of `algorithms` (first match wins).
 */
export function negotiateCompression(acceptEncoding: string | null, algorithms: readonly CompressAlgorithm[]): CompressionChoice | null {
  if (!acceptEncoding || algorithms.length === 0) return null;

  // Parse tokens like "br;q=1.0, gzip;q=0.8, identity;q=0.5"
  const accepted = new Map<string, number>();
  for (const part of acceptEncoding.split(",")) {
    const [tokenRaw, ...params] = part.trim().split(";");
    const token = tokenRaw?.trim().toLowerCase();
    if (!token) continue;

    let q = 1;
    for (const param of params) {
      const [k, v] = param.trim().split("=");
      if (k?.trim() === "q" && v !== undefined) {
        const parsed = Number.parseFloat(v);
        if (!Number.isNaN(parsed)) q = parsed;
      }
    }
    if (q > 0) accepted.set(token, q);
  }

  // identity-only or empty after q=0 filtering
  if (accepted.size === 0) return null;

  for (const algo of algorithms) {
    if (accepted.has(algo) || accepted.has("*")) {
      return ALGORITHM_TO_CHOICE[algo];
    }
  }

  return null;
}
