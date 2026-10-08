// Cria o primeiro administrador do sistema.
// Uso: node scripts/criar-admin.mjs email@exemplo.com "SenhaForte123" "Nome Completo"
// Requer .env.local preenchido e a migration 00002 aplicada (trigger de perfil).
import { readFileSync } from "node:fs";

const [email, senha, nome] = process.argv.slice(2);
if (!email || !senha || !nome) {
  console.error('Uso: node scripts/criar-admin.mjs <email> <senha> "<Nome Completo>"');
  process.exit(1);
}
if (senha.length < 8) {
  console.error("A senha deve ter pelo menos 8 caracteres.");
  process.exit(1);
}

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Preencha NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env.local.");
  process.exit(1);
}

const resposta = await fetch(`${url}/auth/v1/admin/users`, {
  method: "POST",
  headers: {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    email,
    password: senha,
    email_confirm: true,
    user_metadata: { name: nome, role: "ADMIN" },
  }),
});

const corpo = await resposta.json();
if (!resposta.ok) {
  console.error("Falha ao criar administrador:", corpo.msg ?? corpo.message ?? corpo);
  process.exit(1);
}

// Confirma que o trigger criou o perfil com papel ADMIN
const perfil = await fetch(
  `${url}/rest/v1/users?id=eq.${corpo.id}&select=name,email,role,active`,
  { headers: { apikey: key, Authorization: `Bearer ${key}` } }
).then((r) => r.json());

if (Array.isArray(perfil) && perfil[0]?.role === "ADMIN") {
  console.log(`Administrador criado com sucesso: ${perfil[0].name} <${perfil[0].email}>`);
} else {
  console.warn(
    "Usuário criado no Auth, mas o perfil ADMIN não foi encontrado em public.users.",
    "Verifique se a migration 00002 (trigger handle_new_user) foi aplicada.",
    JSON.stringify(perfil)
  );
}
