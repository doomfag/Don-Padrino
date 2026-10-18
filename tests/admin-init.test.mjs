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
  const owner = store.db
    .prepare("SELECT * FROM users WHERE username='admin'")
    .get();
  assert.equal(owner.role, "owner");
  assert.equal(owner.must_change_password, 0);
  assert.ok(store.verifyPassword(password, owner.password_hash));
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
test("recuperação do proprietário preserva equipe e revoga somente suas sessões", async () => {
  const accounts = await import("../accounts.mjs");
  const owner = store.db
    .prepare("SELECT * FROM users WHERE username='admin'")
    .get();
  const staff = accounts.createUser(owner, {
    username: "recovery-test",
    name: "Equipe teste",
    password: "fixture-only-staff-password",
    permissions: { manageOrders: false, confirmPayments: false },
  });
  store.db
    .prepare("INSERT INTO sessions(token,expires,user_id) VALUES(?,?,?)")
    .run("b".repeat(64), Date.now() + 60000, owner.id);
  store.db
    .prepare("INSERT INTO sessions(token,expires,user_id) VALUES(?,?,?)")
    .run("c".repeat(64), Date.now() + 60000, staff.id);
  accounts.resetOwnerPassword("fixture-only-recovered-password");
  assert.equal(
    store.db
      .prepare("SELECT token FROM sessions WHERE user_id=?")
      .get(owner.id),
    undefined,
  );
  assert.ok(
    store.db
      .prepare("SELECT token FROM sessions WHERE user_id=?")
      .get(staff.id),
  );
  const recovered = store.db
    .prepare("SELECT * FROM users WHERE id=?")
    .get(owner.id);
  assert.ok(
    store.verifyPassword(
      "fixture-only-recovered-password",
      recovered.password_hash,
    ),
  );
  assert.equal(
    store.initializeAdmin("fixture-only-would-reset-password"),
    false,
  );
  assert.ok(
    store.verifyPassword(
      "fixture-only-recovered-password",
      store.getSetting("admin"),
    ),
  );
});
