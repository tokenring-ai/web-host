import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildTlsOptions, isPemMaterial, resolveTlsMaterial } from "./tls.ts";

const SAMPLE_CERT_PEM = `-----BEGIN CERTIFICATE-----
MIIBkTCB+wIJAKHBfpt1t0sHMA0GCSqGSIb3DQEBCwUAMBExDzANBgNVBAMMBnRl
c3RjYTAeFw0yNDAxMDEwMDAwMDBaFw0zNDAxMDEwMDAwMDBaMBExDzANBgNVBAMM
BnRlc3RjYTBcMA0GCSqGSIb3DQEBAQUAA0sAMEgCQQDdummy
-----END CERTIFICATE-----`;

describe("isPemMaterial", () => {
  it("detects PEM content", () => {
    expect(isPemMaterial(SAMPLE_CERT_PEM)).toBe(true);
    expect(isPemMaterial(`  ${SAMPLE_CERT_PEM}`)).toBe(true);
  });

  it("treats paths as non-PEM", () => {
    expect(isPemMaterial("/etc/ssl/certs/cert.pem")).toBe(false);
    expect(isPemMaterial("./certs/key.pem")).toBe(false);
  });
});

describe("resolveTlsMaterial", () => {
  let tmpDir: string;
  let certPath: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "web-host-tls-"));
    certPath = path.join(tmpDir, "cert.pem");
    fs.writeFileSync(certPath, SAMPLE_CERT_PEM);
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns PEM strings as-is", () => {
    expect(resolveTlsMaterial(SAMPLE_CERT_PEM, "certificate")).toBe(SAMPLE_CERT_PEM);
  });

  it("returns Bun.file for existing paths", () => {
    const material = resolveTlsMaterial(certPath, "certificate");
    expect(typeof material).toBe("object");
    expect("name" in (material as object) || material instanceof Blob).toBe(true);
  });

  it("throws for missing files", () => {
    expect(() => resolveTlsMaterial(path.join(tmpDir, "missing.pem"), "certificate")).toThrow(/certificate file not found/);
  });
});

describe("buildTlsOptions", () => {
  it("returns undefined when tls is disabled or missing", () => {
    expect(buildTlsOptions(undefined)).toBeUndefined();
    expect(
      buildTlsOptions({
        enabled: false,
        certificate: SAMPLE_CERT_PEM,
        privateKey: SAMPLE_CERT_PEM,
      }),
    ).toBeUndefined();
  });

  it("builds options from PEM strings when enabled", () => {
    const options = buildTlsOptions({
      enabled: true,
      certificate: SAMPLE_CERT_PEM,
      privateKey: SAMPLE_CERT_PEM,
      passphrase: "secret",
    });
    expect(options).toEqual({
      cert: SAMPLE_CERT_PEM,
      key: SAMPLE_CERT_PEM,
      passphrase: "secret",
    });
  });
});
