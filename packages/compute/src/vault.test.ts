import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Vault } from "./vault.js";

test("vault encrypts and decrypts provider secrets", async () => {
  const dir = await mkdtemp(join(tmpdir(), "provider-bootstrapper-"));
  const path = join(dir, "vault.json");
  const vault = new Vault(path);
  const password = "correct horse battery staple";

  await vault.set("groq", "GROQ_API_KEY", "super-secret", password);
  const raw = await readFile(path, "utf8");
  assert.doesNotMatch(raw, /super-secret/);

  const data = await vault.read(password);
  assert.equal(data.groq.GROQ_API_KEY, "super-secret");
  await rm(dir, { recursive: true, force: true });
});
