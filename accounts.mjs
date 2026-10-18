import {
  db,
  hashPassword,
  verifyPassword,
  initializeAdmin,
  setSetting,
} from "./store.mjs";
const reject = (message, status = 400) => {
  throw Object.assign(new Error(message), { status });
};
export function userView(row) {
  return row
    ? {
        id: row.id,
        username: row.username,
        name: row.name,
        role: row.role,
        enabled: !!row.enabled,
        mustChangePassword: !!row.must_change_password,
        permissions: {
          manageOrders: row.role === "owner" || !!row.manage_orders,
          confirmPayments: row.role === "owner" || !!row.confirm_payments,
        },
        createdAt: row.created_at,
      }
    : null;
}
export function sessionUser(req) {
  const token = (req.headers.cookie || "").match(
    /(?:^|; )dp_session=([a-f0-9]{64})/,
  )?.[1];
  if (!token) return null;
  const row = db
    .prepare(
      "SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token=? AND s.expires>? AND u.enabled=1",
    )
    .get(token, Date.now());
  return row ? { ...userView(row), token } : null;
}
export function requireUser(req, permission) {
  const user = sessionUser(req);
  if (!user) reject("Entre na sua conta para continuar.", 401);
  if (user.mustChangePassword && permission !== "password")
    reject("Troque sua senha temporária para continuar.", 403);
  if (
    (permission === "owner" && user.role !== "owner") ||
    (permission &&
      !["owner", "password"].includes(permission) &&
      !user.permissions[permission])
  )
    reject("Sua conta não tem permissão para esta ação.", 403);
  return user;
}
export function validatePassword(password) {
  if (
    typeof password !== "string" ||
    password.length < 12 ||
    password.length > 256
  )
    reject("Use uma senha de 12 a 256 caracteres.");
}
export function audit(actor, action, target, details = {}) {
  db.prepare(
    "INSERT INTO audit(actor_id,action,target,details,created_at) VALUES(?,?,?,?,?)",
  ).run(
    actor.id,
    action,
    String(target),
    JSON.stringify(details),
    new Date().toISOString(),
  );
}
export function listUsers() {
  return db.prepare("SELECT * FROM users ORDER BY id").all().map(userView);
}
function fields(input) {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (name.length < 2 || name.length > 80)
    reject("Informe um nome de 2 a 80 caracteres.");
  for (const key of ["manageOrders", "confirmPayments"])
    if (typeof input.permissions?.[key] !== "boolean")
      reject("Selecione as permissões da conta.");
  return [
    name,
    Number(input.permissions.manageOrders),
    Number(input.permissions.confirmPayments),
  ];
}
export function createUser(actor, input) {
  const username = String(input.username || "")
    .trim()
    .toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,39}$/.test(username))
    reject("Usuário: use 3 a 40 letras, números, ponto, traço ou sublinhado.");
  if ("role" in input && input.role !== "attendant")
    reject("Somente contas de atendentes podem ser criadas.");
  const [name, manage, pay] = fields(input);
  validatePassword(input.password);
  if (db.prepare("SELECT id FROM users WHERE username=?").get(username))
    reject("Este nome de usuário já está em uso.", 409);
  const result = db
    .prepare(
      "INSERT INTO users(username,name,password_hash,role,manage_orders,confirm_payments,must_change_password,created_at) VALUES(?,?,?,'attendant',?,?,1,?)",
    )
    .run(
      username,
      name,
      hashPassword(input.password),
      manage,
      pay,
      new Date().toISOString(),
    );
  audit(actor, "user.created", result.lastInsertRowid, {
    username,
    manageOrders: !!manage,
    confirmPayments: !!pay,
  });
  return userView(
    db.prepare("SELECT * FROM users WHERE id=?").get(result.lastInsertRowid),
  );
}
export function updateUser(actor, id, input) {
  const current = db.prepare("SELECT * FROM users WHERE id=?").get(id);
  if (!current) reject("Conta não encontrada.", 404);
  if (current.role === "owner")
    reject(
      "A conta do proprietário é protegida. Use Minha senha para alterá-la.",
      403,
    );
  if ("role" in input || "username" in input)
    reject("O usuário e o tipo da conta não podem ser alterados.");
  const merged = {
    name: current.name,
    permissions: userView(current).permissions,
    ...input,
  };
  const [name, manage, pay] = fields(merged);
  if ("enabled" in input && typeof input.enabled !== "boolean")
    reject("Situação da conta inválida.");
  let hash = current.password_hash,
    mustChange = current.must_change_password;
  if ("password" in input) {
    validatePassword(input.password);
    hash = hashPassword(input.password);
    mustChange = 1;
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(
      "UPDATE users SET name=?,manage_orders=?,confirm_payments=?,enabled=?,password_hash=?,must_change_password=? WHERE id=?",
    ).run(
      name,
      manage,
      pay,
      Number(input.enabled ?? !!current.enabled),
      hash,
      mustChange,
      id,
    );
    db.prepare("DELETE FROM sessions WHERE user_id=?").run(id);
    audit(actor, "user.updated", id, {
      enabled: input.enabled ?? !!current.enabled,
      passwordReset: "password" in input,
      manageOrders: !!manage,
      confirmPayments: !!pay,
    });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return userView(db.prepare("SELECT * FROM users WHERE id=?").get(id));
}
export function changePassword(actor, input) {
  const row = db.prepare("SELECT * FROM users WHERE id=?").get(actor.id);
  if (
    typeof input.currentPassword !== "string" ||
    input.currentPassword.length > 256 ||
    !verifyPassword(input.currentPassword, row.password_hash)
  )
    reject("A senha atual não confere.", 403);
  validatePassword(input.password);
  if (verifyPassword(input.password, row.password_hash))
    reject("Escolha uma senha diferente da atual.");
  db.exec("BEGIN IMMEDIATE");
  try {
    const hash = hashPassword(input.password);
    db.prepare(
      "UPDATE users SET password_hash=?,must_change_password=0 WHERE id=?",
    ).run(hash, actor.id);
    if (row.role === "owner") setSetting("admin", hash);
    db.prepare("DELETE FROM sessions WHERE user_id=?").run(actor.id);
    audit(actor, "user.password_changed", actor.id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
export function resetOwnerPassword(password) {
  validatePassword(password);
  initializeAdmin(password);
  const owner = db.prepare("SELECT * FROM users WHERE role='owner'").get();
  const hash = hashPassword(password);
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(
      "UPDATE users SET password_hash=?,must_change_password=0,enabled=1 WHERE id=?",
    ).run(hash, owner.id);
    setSetting("admin", hash);
    db.prepare("DELETE FROM sessions WHERE user_id=?").run(owner.id);
    audit(owner, "owner.recovered", owner.id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
