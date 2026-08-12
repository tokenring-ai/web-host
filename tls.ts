import fs from "node:fs";
import type { TLSOptions } from "bun";
import type { ParsedWebHostTlsConfig } from "./schema.ts";

/**
 * True when the value looks like inline PEM (not a filesystem path).
 * Paths may be absolute or relative; PEM always starts with `-----BEGIN`.
 */
export function isPemMaterial(value: string): boolean {
  return value.trimStart().startsWith("-----BEGIN");
}

/**
 * Resolve a cert/key/CA config value to something Bun.serve accepts:
 * - PEM strings pass through as-is
 * - File paths become `Bun.file(...)` after existence check
 */
export function resolveTlsMaterial(value: string, label: string): string | Bun.BunFile {
  if (isPemMaterial(value)) {
    return value;
  }

  if (!fs.existsSync(value)) {
    throw new Error(`TLS ${label} file not found: ${value}`);
  }

  return Bun.file(value);
}

/**
 * Build Bun.serve `tls` options from web-host config.
 * Returns `undefined` when TLS is disabled or not configured.
 */
export function buildTlsOptions(tls: ParsedWebHostTlsConfig | undefined): TLSOptions | undefined {
  if (!tls?.enabled) return undefined;

  const options: TLSOptions = {
    cert: resolveTlsMaterial(tls.certificate, "certificate"),
    key: resolveTlsMaterial(tls.privateKey, "private key"),
  };

  if (tls.passphrase !== undefined) {
    options.passphrase = tls.passphrase;
  }

  if (tls.ca !== undefined) {
    options.ca = resolveTlsMaterial(tls.ca, "CA certificate");
  }

  return options;
}
