import { $, $$, api, esc, toast, date } from "./lib.js";
const permissionFields = (permissions = {}) =>
  `<label class="checkbox"><input type="checkbox" name="manageOrders" ${permissions.manageOrders ? "checked" : ""}> Alterar etapas, previsão e cancelar pedidos</label><label class="checkbox"><input type="checkbox" name="confirmPayments" ${permissions.confirmPayments ? "checked" : ""}> Confirmar pagamentos recebidos</label>`;
const permissionsOf = (form) => ({
  manageOrders: form.elements.manageOrders.checked,
  confirmPayments: form.elements.confirmPayments.checked,
});
export async function renderTeam(root) {
  root.innerHTML = '<p role="status">Carregando equipe…</p>';
  try {
    const users = await api("/api/admin/users");
    root.innerHTML = `<div class="settings-form team-settings"><h2>Equipe e acessos</h2><p>Cada pessoa entra com seu próprio usuário e senha. Você mantém o controle das configurações e dos acessos. Todas as atendentes podem consultar os pedidos; as permissões abaixo autorizam alterações.</p><form id="create-user" class="team-account"><h3>Adicionar atendente</h3><div class="field-grid"><div class="field"><label for="new-user-name">Nome</label><input id="new-user-name" name="name" minlength="2" maxlength="80" required autocomplete="off"></div><div class="field"><label for="new-user-login">Usuário</label><input id="new-user-login" name="username" pattern="[a-zA-Z0-9][a-zA-Z0-9._-]{2,39}" minlength="3" maxlength="40" required autocomplete="off" autocapitalize="none" spellcheck="false"></div></div><div class="field"><label for="new-user-password">Senha temporária (mínimo 12 caracteres)</label><input id="new-user-password" name="password" type="password" minlength="12" maxlength="256" required autocomplete="new-password"></div>${permissionFields()}<p class="hint">A atendente deverá criar sua própria senha no primeiro acesso. Compartilhe o usuário e a senha temporária por um canal privado.</p><p class="form-error error" role="alert"></p><button class="primary green">CRIAR CONTA</button></form><h2>Contas cadastradas</h2><div id="team-list">${users.map((user) => (user.role === "owner" ? `<article class="team-account"><h3>${esc(user.name)} · ${esc(user.username)}</h3><p>Proprietário · acesso completo</p><p class="hint">Altere sua senha na aba Minha senha. Esta conta não pode ser bloqueada pela equipe.</p></article>` : `<form class="team-account" data-user-id="${user.id}"><h3>${esc(user.username)} · ${user.enabled ? "Ativa" : "Bloqueada"}</h3><div class="field"><label for="team-name-${user.id}">Nome</label><input id="team-name-${user.id}" name="name" value="${esc(user.name)}" minlength="2" maxlength="80" required></div><label class="checkbox"><input type="checkbox" name="enabled" ${user.enabled ? "checked" : ""}> Conta ativa</label>${permissionFields(user.permissions)}<div class="field"><label for="team-reset-${user.id}">Nova senha temporária (opcional)</label><input id="team-reset-${user.id}" name="password" type="password" minlength="12" maxlength="256" autocomplete="new-password" placeholder="Preencha somente para redefinir a senha"></div>${user.mustChangePassword ? '<p class="hint">Troca de senha pendente no próximo acesso.</p>' : ""}<p class="hint">Salvar encerra as sessões desta conta. Desmarque Conta ativa para bloquear o acesso imediatamente.</p><p class="form-error error" role="alert"></p><button class="outline">SALVAR ACESSO</button></form>`)).join("")}</div><h2>Últimas alterações</h2><div id="team-audit" class="hint"></div></div>`;
    $("#create-user", root).onsubmit = async (event) => {
      event.preventDefault();
      const form = event.target;
      await submit(form, "/api/admin/users", "POST", {
        name: form.elements.name.value,
        username: form.elements.username.value,
        password: form.elements.password.value,
        permissions: permissionsOf(form),
      });
    };
    $$("[data-user-id]", root).forEach(
      (form) =>
        (form.onsubmit = async (event) => {
          event.preventDefault();
          const data = {
            name: form.elements.name.value,
            enabled: form.elements.enabled.checked,
            permissions: permissionsOf(form),
          };
          if (form.elements.password.value)
            data.password = form.elements.password.value;
          await submit(
            form,
            `/api/admin/users/${form.dataset.userId}`,
            "PATCH",
            data,
          );
        }),
    );
    async function submit(form, path, method, data) {
      const button = $("button", form);
      button.disabled = true;
      try {
        await api(path, { method, body: JSON.stringify(data) });
        form.reset();
        toast("Acesso salvo.");
        await renderTeam(root);
      } catch (error) {
        $(".form-error", form).textContent = error.message;
        button.disabled = false;
      }
    }
    const log = await api("/api/admin/audit");
    const labels = {
      "user.created": "Criou conta",
      "user.updated": "Alterou acesso",
      "user.password_changed": "Alterou a própria senha",
      "owner.recovered": "Recuperou acesso do proprietário",
      "order.updated": "Atualizou pedido",
      "shop.updated": "Alterou configurações",
    };
    if ($("#team-audit", root))
      $("#team-audit", root).innerHTML = log.length
        ? log
            .map(
              (entry) =>
                `<p>${date(entry.created_at)} · ${esc(entry.username || "Proprietário")} · ${esc(labels[entry.action] || entry.action)}${entry.action.startsWith("order.") ? ` DP-${String(entry.target).padStart(5, "0")}` : ""}</p>`,
            )
            .join("")
        : "<p>Nenhuma alteração registrada.</p>";
  } catch (error) {
    root.textContent = error.message;
  }
}
export function renderPassword(root, forced, onChanged) {
  root.innerHTML = `<form class="settings-form" id="password-form"><h2>${forced ? "Crie sua senha pessoal" : "Minha senha"}</h2><p>${forced ? "Antes de acessar os pedidos, substitua a senha temporária por uma senha só sua." : "Ao trocar a senha, sua conta será desconectada de todos os aparelhos. Entre novamente com a nova senha."}</p><div class="field"><label for="current-password">${forced ? "Senha temporária" : "Senha atual"}</label><input id="current-password" name="currentPassword" type="password" maxlength="256" required autocomplete="current-password"></div><div class="field"><label for="new-password">Nova senha (mínimo 12 caracteres)</label><input id="new-password" name="password" type="password" minlength="12" maxlength="256" required autocomplete="new-password"></div><div class="field"><label for="confirm-password">Repita a nova senha</label><input id="confirm-password" name="confirmPassword" type="password" minlength="12" maxlength="256" required autocomplete="new-password"></div><p class="form-error error" role="alert"></p><button class="primary green">SALVAR NOVA SENHA</button></form>`;
  $("#password-form", root).onsubmit = async (event) => {
    event.preventDefault();
    const form = event.target,
      error = $(".form-error", form),
      button = $("button", form);
    if (form.elements.password.value !== form.elements.confirmPassword.value) {
      error.textContent = "As novas senhas não conferem.";
      return;
    }
    button.disabled = true;
    try {
      await api("/api/admin/password", {
        method: "POST",
        body: JSON.stringify({
          currentPassword: form.elements.currentPassword.value,
          password: form.elements.password.value,
        }),
      });
      form.reset();
      toast("Senha alterada. Entre com sua nova senha.");
      await onChanged();
    } catch (err) {
      error.textContent = err.message;
      button.disabled = false;
    }
  };
}
