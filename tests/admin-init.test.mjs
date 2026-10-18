import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
let dir, store;
before(async () => {
  dir = await mkdtemp(join(tmpdir(), "padrino-admin-init-"));
  process.env.DATA_DIR = dir;
  store = await import("../store.mjs");
});
after(async () => {
  store.db.close();
  await rm(dir, { recursive: true, force: true });
});
test("inicialização exige senha forte e persiste somente hash", () => {
  assert.equal(store.getSetting("admin"), null);
  assert.equal(store.initializeAdmin(""), false);
  assert.throws(() => store.initializeAdmin("curta"), /12 e 256/);
  assert.equal(store.getSetting("admin"), null);
  const password = "fixture-only-initial-password-123";
  assert.equal(store.initializeAdmin(password), true);
  const hash = store.getSetting("admin");
  assert.ok(!hash.includes(password));
  assert.ok(store.verifyPassword(password, hash));
  assert.ok(!store.verifyPassword("outra-senha", hash));
});
test("novos deploys não redefinem uma conta existente", () => {
  const original = store.getSetting("admin");
  assert.equal(
    store.initializeAdmin("fixture-only-another-password-456"),
    false,
  );
  assert.equal(store.initializeAdmin(""), false);
  assert.equal(store.getSetting("admin"), original);
});
