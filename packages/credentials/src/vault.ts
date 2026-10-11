import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { CredentialError } from "./errors.js";
import type { CredentialMetadata, ValidationStatus } from "./types.js";

interface VaultFile {
  version: 1;
  kdf: "scrypt";
  salt: string;
  iv: string;
  tag: string;
  ciphertext: string;
}

export type VaultData = Record<string, Record<string, string>> & {
  __meta?: Record<string, CredentialMetadata>;
};

export class Vault {
  constructor(private readonly filePath = ".providers-vault/vault.json") {}

  async exists(): Promise<boolean> {
    try {
      await readFile(this.filePath, "utf8");
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new CredentialError("CREDENTIAL_SOURCE_UNAVAILABLE");
      return false;
    }
  }

  async read(password: string): Promise<VaultData> {
    if (!(await this.exists())) {
      return {};
    }
    try {
      const raw = await readFile(this.filePath, "utf8");
      const envelope = JSON.parse(raw) as VaultFile;
      const key = deriveKey(password, Buffer.from(envelope.salt, "base64"));
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
      decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
      const decrypted = Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, "base64")),
        decipher.final()
      ]);
      return JSON.parse(decrypted.toString("utf8")) as VaultData;
    } catch {
      // Never propagate native parser snippets containing decrypted/source data.
      throw new CredentialError("CREDENTIAL_DECRYPTION_FAILED");
    }
  }

  async write(password: string, data: VaultData): Promise<void> {
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const key = deriveKey(password, salt);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(Buffer.from(JSON.stringify(data, null, 2), "utf8")),
      cipher.final()
    ]);
    const envelope: VaultFile = {
      version: 1,
      kdf: "scrypt",
      salt: salt.toString("base64"),
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64")
    };
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(envelope, null, 2), { mode: 0o600 });
    await rename(tmp, this.filePath);
  }

  async set(providerId: string, envVar: string, value: string, password: string): Promise<void> {
    const data = await this.read(password);
    data[providerId] ??= {};
    data[providerId][envVar] = value;
    data.__meta ??= {};
    const key = metadataKey(providerId, envVar);
    const now = new Date().toISOString();
    data.__meta[key] = {
      providerId,
      envVar,
      createdAt: data.__meta[key]?.createdAt ?? now,
      updatedAt: now,
      lastValidatedAt: undefined,
      validationStatus: "not-run"
    };
    await this.write(password, data);
  }

  async revoke(providerId: string, envVar: string, password: string): Promise<void> {
    const data = await this.read(password);
    if (data[providerId]) {
      delete data[providerId][envVar];
    }
    data.__meta ??= {};
    const key = metadataKey(providerId, envVar);
    const now = new Date().toISOString();
    data.__meta[key] = {
      providerId,
      envVar,
      createdAt: data.__meta[key]?.createdAt ?? now,
      updatedAt: now,
      revokedAt: now,
      validationStatus: data.__meta[key]?.validationStatus
    };
    await this.write(password, data);
  }

  async markValidation(providerId: string, envVar: string, status: ValidationStatus, password: string): Promise<void> {
    const data = await this.read(password);
    data.__meta ??= {};
    const key = metadataKey(providerId, envVar);
    const now = new Date().toISOString();
    data.__meta[key] = {
      providerId,
      envVar,
      createdAt: data.__meta[key]?.createdAt ?? now,
      updatedAt: data.__meta[key]?.updatedAt ?? now,
      lastValidatedAt: now,
      validationStatus: status,
      revokedAt: data.__meta[key]?.revokedAt
    };
    await this.write(password, data);
  }
}

function metadataKey(providerId: string, envVar: string): string {
  return `${providerId}:${envVar}`;
}

function deriveKey(password: string, salt: Buffer): Buffer {
  if (password.length < 12) {
    throw new Error("Vault password must be at least 12 characters.");
  }
  return scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 });
}
