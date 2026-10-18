import { stdin, stdout } from "node:process";
import { emitKeypressEvents } from "node:readline";
import { db } from "../store.mjs";
import { resetOwnerPassword } from "../accounts.mjs";
if (!stdin.isTTY) {
  console.error(
    "Execute em um terminal interativo para cadastrar a senha com segurança.",
  );
  process.exit(1);
}
async function secret(prompt) {
  emitKeypressEvents(stdin);
  stdin.setRawMode(true);
  stdin.resume();
  return new Promise((resolve) => {
    let value = "";
    function key(str, key) {
      if (key?.ctrl && key.name === "c") process.exit(1);
      if (key?.name === "return" || key?.name === "enter") {
        stdin.off("keypress", keyHandler);
        stdin.setRawMode(false);
        stdout.write("\n");
        resolve(value);
      } else if (key?.name === "backspace") value = value.slice(0, -1);
      else if (str && !key?.ctrl) value += str;
    }
    const keyHandler = key;
    stdin.on("keypress", keyHandler);
    stdout.write(prompt);
  });
}
const password = await secret(
  "Nova senha de administrador (mínimo 12 caracteres): ",
);
if (password.length < 12 || password.length > 256) {
  console.error("Use entre 12 e 256 caracteres.");
  process.exit(1);
}
if (password !== (await secret("Confirme a senha: "))) {
  console.error("As senhas não conferem.");
  process.exit(1);
}
resetOwnerPassword(password);
db.close();
console.log(
  "Acesso administrativo configurado. Entre em /admin com o usuário admin e a senha cadastrada.",
);
process.exit(0);
