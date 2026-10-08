/**
 * Popula um banco VAZIO com dados fictícios de demonstração.
 *
 * Uso: npm run seed   (requer .env.local e as migrations aplicadas)
 *
 * As planilhas são geradas na hora, cobrindo os últimos 30 dias até ontem,
 * para que a demonstração abra sempre com dados do mês corrente.
 *
 * As planilhas passam pelo mesmo caminho de um upload de verdade: parser →
 * prévia gravada em import_rows → confirm_import (transacional, no banco) →
 * atribuições → recálculo completo da produção. Assim o que aparece nas telas
 * é exatamente o que o sistema calcularia, e não números inseridos à mão.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { parsePlanilha } from "@/lib/importacao/parser";
import { normalizarNome } from "@/lib/normalizacao";
import { processarAtribuicoesDosUploads } from "@/lib/atribuicoes";
import { recalcularProducao } from "@/lib/calculo/persistencia";
import { somarDias } from "@/lib/calculo/motor";

const SENHA_DEMO = "demo12345";
const USUARIOS = [
  { email: "admin@demo.local", nome: "Administrador Demo", papel: "ADMIN" },
  { email: "gestor@demo.local", nome: "Gestora Demo", papel: "MANAGER" },
  { email: "vendedor@demo.local", nome: "Ana Paula Reis", papel: "SELLER" },
] as const;
// DIEGO FARIAS fica de fora de propósito: aparece na planilha sem cadastro e
// vira pendência de vendedor desconhecido.
const VENDEDORES = ["ANA PAULA REIS", "BRUNO COSTA LIMA", "CARLA MENDES"];
const BUCKET = "planilhas";
const PASTA = join(process.cwd(), ".demo-seed");
// Carga inicial há 30 dias: a última cobertura é ontem e o último relatório, hoje.
const hoje = new Date().toLocaleDateString("sv-SE"); // AAAA-MM-DD no fuso local
const INICIO = somarDias(hoje, -30);

const admin = criarClienteAdmin();

function falhar(msg: string, erro?: { message: string } | null): never {
  throw new Error(erro ? `${msg}: ${erro.message}` : msg);
}

async function exigirBancoVazio() {
  const { count, error } = await admin
    .from("imports")
    .select("id", { count: "exact", head: true });
  if (error) falhar("Não consegui ler o banco (as migrations foram aplicadas?)", error);
  if ((count ?? 0) > 0) {
    falhar("O banco já tem uploads. Para recomeçar: npx supabase db reset");
  }
}

async function criarUsuarios(): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};
  for (const u of USUARIOS) {
    const { data, error } = await admin.auth.admin.createUser({
      email: u.email,
      password: SENHA_DEMO,
      email_confirm: true,
      user_metadata: { name: u.nome },
    });
    if (error || !data.user) falhar(`Falha ao criar ${u.email}`, error);
    // O gatilho cria o perfil sempre como SELLER; o papel é promovido aqui,
    // como faria a tela de administração.
    const { error: erroPapel } = await admin
      .from("users")
      .update({ role: u.papel })
      .eq("id", data.user.id);
    if (erroPapel) falhar(`Falha ao definir o papel de ${u.email}`, erroPapel);
    ids[u.email] = data.user.id;
  }
  return ids;
}

async function criarVendedores(usuarioVendedor: string) {
  const linhas = VENDEDORES.map((nome) => ({
    name: nome,
    normalized_name: normalizarNome(nome),
    entry_date: somarDias(INICIO, -60),
    user_id: nome === "ANA PAULA REIS" ? usuarioVendedor : null,
  }));
  const { error } = await admin.from("sellers").insert(linhas);
  if (error) falhar("Falha ao criar vendedores", error);
}

async function enviarPlanilhas(adminId: string) {
  const { error: erroBucket } = await admin.storage.createBucket(BUCKET, { public: false });
  if (erroBucket && !/already exists/i.test(erroBucket.message)) {
    falhar("Falha ao preparar o armazenamento", erroBucket);
  }

  rmSync(PASTA, { recursive: true, force: true });
  execFileSync(process.execPath, ["scripts/gerar-planilhas.mjs", `--inicio=${INICIO}`, "--saida=.demo-seed"], {
    stdio: "inherit",
  });
  const arquivos = readdirSync(PASTA).filter((f) => /^relatorio-\d{4}-\d{2}-\d{2}\.xlsx$/.test(f)).sort();

  for (const nome of arquivos) {
    const reportDate = nome.slice("relatorio-".length, -".xlsx".length);
    const coverageDate = somarDias(reportDate, -1);
    const buf = readFileSync(join(PASTA, nome));
    const checksum = createHash("sha256").update(buf).digest("hex");
    const resultado = parsePlanilha(buf, coverageDate);
    if (!resultado.ok) falhar(`${nome}: colunas faltando (${resultado.colunasFaltantes.join(", ")})`);

    const chave = `${reportDate}/${checksum}.xlsx`;
    const { error: erroArquivo } = await admin.storage.from(BUCKET).upload(chave, buf, {
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      upsert: true,
    });
    if (erroArquivo) falhar(`${nome}: falha ao armazenar`, erroArquivo);

    const { data: imp, error: erroImport } = await admin
      .from("imports")
      .insert({
        report_date: reportDate,
        coverage_end_date: coverageDate,
        file_name: nome,
        file_storage_key: chave,
        checksum_sha256: checksum,
        status: "PREVIA",
        version: 1,
        total_rows: resultado.linhas.length,
        uploaded_by: adminId,
      })
      .select("id")
      .single();
    if (erroImport || !imp) falhar(`${nome}: falha ao registrar o upload`, erroImport);

    const { error: erroLinhas } = await admin.from("import_rows").insert(
      resultado.linhas.map((l) => ({
        import_id: imp.id,
        row_number: l.numero,
        raw_data: l.bruto,
        normalized_data: l.normalizado,
        status: l.status,
      }))
    );
    if (erroLinhas) falhar(`${nome}: falha ao gravar a prévia`, erroLinhas);

    const { error: erroConfirmar } = await admin.rpc("confirm_import", {
      p_import_id: imp.id,
      p_user_id: adminId,
    });
    if (erroConfirmar) falhar(`${nome}: falha ao confirmar`, erroConfirmar);

    // Cada dia é processado antes do próximo, como na rotina real: é isso que
    // faz a troca de responsável e os clientes novos caírem no dia certo.
    await processarAtribuicoesDosUploads();
    process.stdout.write(".");
  }
  console.log(` ${arquivos.length} uploads confirmados.`);
}

async function criarCampanha(adminId: string) {
  const { data: campanha, error } = await admin
    .from("campaigns")
    .insert({
      name: "Campanha do mês",
      description: "Meta mensal de volume e captação da equipe.",
      // Começa no dia seguinte à carga inicial: quem já estava na base não é
      // "cliente novo" da campanha.
      start_date: somarDias(INICIO, 1),
      end_date: somarDias(INICIO, 34),
      primary_metric: "VOLUME",
      target_value: 250000,
      status: "ATIVA",
      created_by: adminId,
    })
    .select("id")
    .single();
  if (error || !campanha) falhar("Falha ao criar a campanha", error);

  const { data: vendedores } = await admin.from("sellers").select("id");
  const { error: erroParticipantes } = await admin
    .from("campaign_sellers")
    .insert((vendedores ?? []).map((v) => ({ campaign_id: campanha.id, seller_id: v.id })));
  if (erroParticipantes) falhar("Falha ao incluir participantes", erroParticipantes);

  const { error: erroMetas } = await admin.from("campaign_goals").insert([
    { campaign_id: campanha.id, metric: "VOLUME", target_value: 250000, label: "Volume do mês" },
    { campaign_id: campanha.id, metric: "NEW_CLIENTS", target_value: 10, label: "Novos clientes" },
  ]);
  if (erroMetas) falhar("Falha ao criar as metas", erroMetas);
}

async function main() {
  await exigirBancoVazio();
  const ids = await criarUsuarios();
  const adminId = ids["admin@demo.local"];
  await criarVendedores(ids["vendedor@demo.local"]);
  await enviarPlanilhas(adminId);
  const resumo = await recalcularProducao();
  await criarCampanha(adminId);

  console.log("Recálculo:", resumo);
  console.log("\nPronto. Acesse http://localhost:3000 com qualquer um destes usuários:");
  for (const u of USUARIOS) console.log(`  ${u.email.padEnd(22)} senha: ${SENHA_DEMO}  (${u.papel})`);
}

main().catch((e) => {
  console.error("\nSeed interrompido:", e instanceof Error ? e.message : e);
  process.exit(1);
});
