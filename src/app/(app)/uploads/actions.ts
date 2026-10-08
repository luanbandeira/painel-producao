"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigirPerfil } from "@/lib/auth";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { registrarAuditoria } from "@/lib/audit";
import { parsePlanilha } from "@/lib/importacao/parser";
import { recalcularProducao } from "@/lib/calculo/persistencia";
import { processarAtribuicoesDosUploads } from "@/lib/atribuicoes";
import { analisarPrevia } from "@/lib/previaAnalise";
import { diferencaDias, somarDias } from "@/lib/calculo/motor";
import type { Perfil } from "@/types/database";
import { FRASE_EXCLUSAO } from "@/lib/constantes";

export interface EstadoUpload {
  erro?: string;
}

const BUCKET = "planilhas";
const LIMITE_BYTES = 10 * 1024 * 1024;

async function garantirBucket(admin: ReturnType<typeof criarClienteAdmin>) {
  const { error } = await admin.storage.createBucket(BUCKET, { public: false });
  if (error && !/already exists/i.test(error.message)) {
    throw new Error(`Falha ao preparar o armazenamento: ${error.message}`);
  }
}

function dataValida(iso: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) && !isNaN(Date.parse(iso));
}

interface ResultadoReprocessamento {
  ok: boolean;
  mensagem: string;
}

/**
 * Reprocessa atribuições + produção.
 *
 * Nunca lança: as operações que chamam isso (confirmar, cancelar, restaurar)
 * já concluíram e não devem ser desfeitas por uma falha no recálculo, que é
 * idempotente e pode ser refeito. Mas o resultado é devolvido para que a
 * tela possa avisar — uma falha silenciosa aqui esconde números errados.
 */
async function reprocessarTudo(
  perfil: Perfil,
  contexto: string
): Promise<ResultadoReprocessamento> {
  try {
    const atribuicoes = await processarAtribuicoesDosUploads();
    const resumo = await recalcularProducao();
    await registrarAuditoria({
      userId: perfil.id,
      action: "PRODUCTION_RECALCULATED",
      entityType: "SYSTEM",
      after: { contexto, ...resumo, atribuicoes } as unknown as Record<string, unknown>,
    });

    const partes = [
      `${resumo.gravados} cálculo(s) gravado(s)`,
      `${resumo.validos} válido(s)`,
    ];
    if (resumo.semBase > 0) partes.push(`${resumo.semBase} sem base`);
    if (resumo.negativos > 0) partes.push(`${resumo.negativos} com delta negativo`);
    if (atribuicoes.criadas > 0) partes.push(`${atribuicoes.criadas} atribuição(ões) nova(s)`);
    if (atribuicoes.obsoletasFechadas > 0) {
      partes.push(`${atribuicoes.obsoletasFechadas} pendência(s) obsoleta(s) encerrada(s)`);
    }
    if (resumo.novasPendencias > 0) {
      partes.push(`${resumo.novasPendencias} pendência(s) nova(s)`);
    }

    // Sinal de alarme: se o gravado não bate com o calculado, algo se perdeu
    if (resumo.gravados !== resumo.intervalos) {
      return {
        ok: false,
        mensagem: `Atenção: foram calculados ${resumo.intervalos} intervalos, mas ${resumo.gravados} foram gravados. Refaça o recálculo e avise o suporte se persistir.`,
      };
    }

    return { ok: true, mensagem: `Produção recalculada — ${partes.join(", ")}.` };
  } catch (e) {
    const erro = e instanceof Error ? e.message : String(e);
    console.error(`Falha no recálculo (${contexto}):`, e);
    await registrarAuditoria({
      userId: perfil.id,
      action: "PRODUCTION_RECALC_FAILED",
      entityType: "SYSTEM",
      after: { contexto, error: erro },
    });
    return {
      ok: false,
      mensagem: `Falha ao recalcular a produção: ${erro}. Os números na tela podem estar desatualizados — tente novamente.`,
    };
  }
}

interface DadosPrevia {
  arquivo: File;
  reportDate: string;
  coverageDate: string;
  perfil: Perfil;
  versao: number;
  replacedImportId: string | null;
}

/** Núcleo compartilhado: valida, armazena e cria a prévia. */
async function criarPrevia(dados: DadosPrevia): Promise<{ erro?: string; id?: string }> {
  const { arquivo, reportDate, coverageDate, perfil } = dados;

  if (!arquivo || arquivo.size === 0) return { erro: "Selecione um arquivo .xlsx." };
  if (!arquivo.name.toLowerCase().endsWith(".xlsx")) {
    return { erro: "Apenas arquivos .xlsx são aceitos." };
  }
  if (arquivo.size > LIMITE_BYTES) {
    return { erro: "O arquivo excede o limite de 10 MB." };
  }
  if (!dataValida(reportDate) || !dataValida(coverageDate)) {
    return { erro: "Informe a data do relatório e a data de cobertura." };
  }
  if (coverageDate > reportDate) {
    return { erro: "A data de cobertura não pode ser posterior à data do relatório." };
  }

  const buf = Buffer.from(await arquivo.arrayBuffer());
  const checksum = createHash("sha256").update(buf).digest("hex");
  const admin = criarClienteAdmin();

  // mesmo arquivo já enviado → bloquear e apontar o original
  const { data: duplicados } = await admin
    .from("imports")
    .select("id, report_date, status")
    .eq("checksum_sha256", checksum)
    .neq("status", "EXCLUIDO")
    .limit(1);
  if (duplicados && duplicados.length > 0) {
    return {
      erro: `Este arquivo já foi enviado (upload da data ${duplicados[0].report_date}, situação ${duplicados[0].status}).`,
    };
  }

  const resultado = parsePlanilha(buf, coverageDate);
  if (!resultado.ok) {
    return {
      erro: `A planilha não contém todas as colunas obrigatórias. Faltando: ${resultado.colunasFaltantes.join(", ")}.`,
    };
  }
  if (resultado.linhas.length === 0) {
    return { erro: "A planilha não contém linhas de dados." };
  }

  try {
    await garantirBucket(admin);
  } catch (e) {
    return { erro: e instanceof Error ? e.message : "Falha no armazenamento." };
  }

  const chave = `${reportDate}/${checksum}.xlsx`;
  const upload = await admin.storage.from(BUCKET).upload(chave, buf, {
    contentType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    upsert: true,
  });
  if (upload.error) {
    return { erro: `Falha ao armazenar o arquivo: ${upload.error.message}` };
  }

  const { data: imp, error: erroImport } = await admin
    .from("imports")
    .insert({
      report_date: reportDate,
      coverage_end_date: coverageDate,
      file_name: arquivo.name,
      file_storage_key: chave,
      checksum_sha256: checksum,
      status: "PREVIA",
      version: dados.versao,
      replaced_import_id: dados.replacedImportId,
      total_rows: resultado.linhas.length,
      uploaded_by: perfil.id,
    })
    .select("id")
    .single();
  if (erroImport || !imp) {
    return { erro: `Falha ao registrar o upload: ${erroImport?.message}` };
  }

  const linhas = resultado.linhas.map((l) => ({
    import_id: imp.id,
    row_number: l.numero,
    raw_data: l.bruto,
    normalized_data: l.normalizado,
    status: l.status,
  }));
  for (let i = 0; i < linhas.length; i += 200) {
    const { error } = await admin
      .from("import_rows")
      .insert(linhas.slice(i, i + 200));
    if (error) {
      await admin.from("import_rows").delete().eq("import_id", imp.id);
      await admin.from("imports").delete().eq("id", imp.id);
      await admin.storage.from(BUCKET).remove([chave]);
      return { erro: `Falha ao gravar as linhas da prévia: ${error.message}` };
    }
  }

  return { id: imp.id };
}

export interface AnalisePlanilha {
  ok: boolean;
  erro?: string;
  linhas: number;
  /** Maior data de compra encontrada — o que o arquivo realmente cobre. */
  cobertura: string | null;
  /** Data do relatório sugerida: o dia seguinte à cobertura (D+1). */
  relatorio: string | null;
  /** Cobertura do upload ativo mais recente, para comparação. */
  coberturaAtual: string | null;
  /** Dias entre a cobertura atual e a do arquivo. */
  diasDeAvanco: number | null;
  duplicado: boolean;
}

/**
 * Lê a planilha assim que ela é escolhida e deduz o que ela cobre, sem gravar
 * nada. Evita que o usuário precise adivinhar datas: elas vêm da própria
 * coluna de última compra do arquivo.
 */
export async function analisarPlanilha(
  formData: FormData
): Promise<AnalisePlanilha> {
  await exigirPerfil(["ADMIN", "MANAGER"]);

  const vazio: AnalisePlanilha = {
    ok: false,
    linhas: 0,
    cobertura: null,
    relatorio: null,
    coberturaAtual: null,
    diasDeAvanco: null,
    duplicado: false,
  };

  const arquivo = formData.get("arquivo") as File | null;
  if (!arquivo || arquivo.size === 0) {
    return { ...vazio, erro: "Selecione um arquivo .xlsx." };
  }
  if (!arquivo.name.toLowerCase().endsWith(".xlsx")) {
    return { ...vazio, erro: "Apenas arquivos .xlsx são aceitos." };
  }
  if (arquivo.size > LIMITE_BYTES) {
    return { ...vazio, erro: "O arquivo excede o limite de 10 MB." };
  }

  const buf = Buffer.from(await arquivo.arrayBuffer());
  const resultado = parsePlanilha(buf);

  if (!resultado.ok) {
    return {
      ...vazio,
      erro: `A planilha não contém todas as colunas obrigatórias. Faltando: ${resultado.colunasFaltantes.join(", ")}.`,
    };
  }
  if (resultado.linhas.length === 0) {
    return { ...vazio, erro: "A planilha não contém linhas de dados." };
  }

  // A maior data de compra é o que o arquivo efetivamente cobre
  const cobertura = resultado.linhas.reduce<string | null>((max, l) => {
    const d = l.normalizado.last_purchase_date;
    return d && (max === null || d > max) ? d : max;
  }, null);

  const admin = criarClienteAdmin();
  const checksum = createHash("sha256").update(buf).digest("hex");

  const [{ data: duplicados }, { data: ativos }] = await Promise.all([
    admin
      .from("imports")
      .select("id")
      .eq("checksum_sha256", checksum)
      .neq("status", "EXCLUIDO")
      .limit(1),
    admin
      .from("imports")
      .select("coverage_end_date")
      .in("status", ["ATIVO", "COM_PENDENCIAS"])
      .order("coverage_end_date", { ascending: false })
      .limit(1),
  ]);

  const coberturaAtual = (ativos?.[0]?.coverage_end_date as string) ?? null;

  return {
    ok: true,
    linhas: resultado.linhas.length,
    cobertura,
    relatorio: cobertura ? somarDias(cobertura, 1) : null,
    coberturaAtual,
    diasDeAvanco:
      cobertura && coberturaAtual ? diferencaDias(coberturaAtual, cobertura) : null,
    duplicado: (duplicados ?? []).length > 0,
  };
}

/** Upload comum (nova data). */
export async function processarPrevia(
  _estado: EstadoUpload,
  formData: FormData
): Promise<EstadoUpload> {
  const perfil = await exigirPerfil(["ADMIN", "MANAGER"]);
  const reportDate = String(formData.get("report_date") ?? "");
  const admin = criarClienteAdmin();

  // Uma única versão ativa por data; para corrigir, use Substituir
  if (dataValida(reportDate)) {
    const { data: ativos } = await admin
      .from("imports")
      .select("id")
      .eq("report_date", reportDate)
      .in("status", ["ATIVO", "COM_PENDENCIAS"])
      .limit(1);
    if (ativos && ativos.length > 0) {
      return {
        erro: "Já existe um upload ativo para esta data. Para enviar uma nova versão, abra o upload e use a ação Substituir.",
      };
    }
  }

  const resultado = await criarPrevia({
    arquivo: formData.get("arquivo") as File,
    reportDate,
    coverageDate: String(formData.get("coverage_end_date") ?? ""),
    perfil,
    versao: 1,
    replacedImportId: null,
  });
  if (resultado.erro || !resultado.id) return { erro: resultado.erro };

  await registrarAuditoria({
    userId: perfil.id,
    action: "IMPORT_PREVIEW_CREATED",
    entityType: "IMPORT",
    entityId: resultado.id,
    after: { report_date: reportDate },
  });

  /*
   * Atalho do dia normal: sem nada que exija atenção, confirma na hora.
   *
   * A prévia continua sendo gerada, gravada e auditada — o que muda é não
   * exigir um segundo clique de quem não tem o que decidir. O veredito vem de
   * `analisarPrevia`, a mesma leitura que a tela mostra, então o sistema nunca
   * confirma sozinho algo que ele apontaria como digno de atenção.
   *
   * Substituição de upload ativo não entra aqui de propósito: ali sempre há o
   * que comparar antes.
   */
  if (formData.get("auto_confirmar") === "on") {
    const { veredito } = await analisarPrevia(resultado.id);
    if (veredito.pronto) {
      const confirmacao = await executarConfirmacao(
        resultado.id,
        perfil,
        "Confirmação automática: a prévia não tinha nada que exigisse atenção."
      );
      if (confirmacao.ok) {
        const reproc = await reprocessarTudo(perfil, "confirmacao");
        if (!reproc.ok) console.error(reproc.mensagem);
        revalidatePath("/uploads");
        revalidatePath("/clientes");
        revalidatePath("/pendencias");
        redirect(`/uploads/${resultado.id}?auto=1`);
      }
      // Falha na confirmação automática não perde nada: a prévia continua lá
      // para ser confirmada à mão, com o erro visível na tela
    }
  }

  revalidatePath("/uploads");
  redirect(`/uploads/${resultado.id}`);
}

/** prévia de substituição de um upload ativo. */
export async function processarPreviaSubstituicao(
  importIdAntigo: string,
  _estado: EstadoUpload,
  formData: FormData
): Promise<EstadoUpload> {
  const perfil = await exigirPerfil(["ADMIN", "MANAGER"]);
  const motivo = String(formData.get("motivo") ?? "").trim();
  if (!motivo) return { erro: "O motivo da substituição é obrigatório." };

  const admin = criarClienteAdmin();
  const { data: antigo } = await admin
    .from("imports")
    .select("id, report_date, coverage_end_date, version, status")
    .eq("id", importIdAntigo)
    .single();
  if (!antigo) return { erro: "Upload original não encontrado." };
  if (!["ATIVO", "COM_PENDENCIAS"].includes(antigo.status)) {
    return { erro: "Somente uploads ativos podem ser substituídos." };
  }

  const resultado = await criarPrevia({
    arquivo: formData.get("arquivo") as File,
    reportDate: antigo.report_date,
    coverageDate:
      String(formData.get("coverage_end_date") ?? "") || antigo.coverage_end_date,
    perfil,
    versao: antigo.version + 1,
    replacedImportId: antigo.id,
  });
  if (resultado.erro || !resultado.id) return { erro: resultado.erro };

  await registrarAuditoria({
    userId: perfil.id,
    action: "IMPORT_REPLACE_PREVIEW_CREATED",
    entityType: "IMPORT",
    entityId: resultado.id,
    after: { replaces: antigo.id, version: antigo.version + 1 },
    reason: motivo,
  });

  revalidatePath("/uploads");
  redirect(`/uploads/${resultado.id}`);
}

const ERROS_CONHECIDOS: Record<string, string> = {
  IMPORT_NOT_FOUND: "Upload não encontrado.",
  IMPORT_NOT_IN_PREVIEW: "Este upload não está mais em prévia.",
  IMPORT_DATE_ALREADY_ACTIVE: "Já existe um upload ativo para esta data.",
};

async function executarConfirmacao(
  id: string,
  perfil: Perfil,
  /** Registrado na auditoria — distingue a confirmação automática da manual. */
  motivo?: string
): Promise<EstadoUpload & { ok?: boolean }> {
  const admin = criarClienteAdmin();
  const { data, error } = await admin.rpc("confirm_import", {
    p_import_id: id,
    p_user_id: perfil.id,
  });

  if (error) {
    const codigo = Object.keys(ERROS_CONHECIDOS).find((c) =>
      error.message.includes(c)
    );
    if (codigo) return { erro: ERROS_CONHECIDOS[codigo] };

    await admin
      .from("imports")
      .update({ status: "ERRO", error_message: error.message })
      .eq("id", id)
      .eq("status", "PREVIA");
    await registrarAuditoria({
      userId: perfil.id,
      action: "IMPORT_ERROR",
      entityType: "IMPORT",
      entityId: id,
      after: { error: error.message },
    });
    return {
      erro: "Ocorreu uma falha no processamento. Nada foi gravado; você pode tentar novamente.",
    };
  }

  await registrarAuditoria({
    userId: perfil.id,
    action: "IMPORT_CONFIRMED",
    entityType: "IMPORT",
    entityId: id,
    after: data as Record<string, unknown>,
    reason: motivo,
  });
  return { ok: true };
}

/** Confirmação de upload comum. */
export async function confirmarImportacao(
  id: string,
  _estado: EstadoUpload,
  _formData: FormData
): Promise<EstadoUpload> {
  const perfil = await exigirPerfil(["ADMIN", "MANAGER"]);
  const resultado = await executarConfirmacao(id, perfil);
  if (resultado.erro) return { erro: resultado.erro };

  const reproc = await reprocessarTudo(perfil, "confirmacao");
  if (!reproc.ok) console.error(reproc.mensagem);

  revalidatePath("/uploads");
  revalidatePath("/clientes");
  revalidatePath("/pendencias");
  redirect(`/uploads/${id}`);
}

/** Confirmação de substituição: antigo vira SUBSTITUIDO, novo entra no lugar. */
export async function confirmarSubstituicao(
  id: string,
  _estado: EstadoUpload,
  _formData: FormData
): Promise<EstadoUpload> {
  const perfil = await exigirPerfil(["ADMIN", "MANAGER"]);
  const admin = criarClienteAdmin();

  const { data: novo } = await admin
    .from("imports")
    .select("id, status, replaced_import_id")
    .eq("id", id)
    .single();
  if (!novo?.replaced_import_id) return { erro: "Este upload não é uma substituição." };
  if (novo.status !== "PREVIA") return { erro: "Este upload não está mais em prévia." };

  const { data: antigo } = await admin
    .from("imports")
    .select("id, status")
    .eq("id", novo.replaced_import_id)
    .single();
  if (!antigo || !["ATIVO", "COM_PENDENCIAS"].includes(antigo.status)) {
    return { erro: "O upload original não está mais ativo." };
  }

  // Libera a data (índice de versão única) antes de confirmar o novo
  const statusAnterior = antigo.status;
  await admin.from("imports").update({ status: "SUBSTITUIDO" }).eq("id", antigo.id);

  const resultado = await executarConfirmacao(id, perfil);
  if (resultado.erro) {
    // Reativa o antigo para não deixar a data sem versão ativa
    await admin.from("imports").update({ status: statusAnterior }).eq("id", antigo.id);
    return { erro: resultado.erro };
  }

  await registrarAuditoria({
    userId: perfil.id,
    action: "IMPORT_REPLACED",
    entityType: "IMPORT",
    entityId: antigo.id,
    after: { replaced_by: id },
  });

  const reproc = await reprocessarTudo(perfil, "substituicao");
  if (!reproc.ok) console.error(reproc.mensagem);

  revalidatePath("/uploads");
  revalidatePath("/pendencias");
  redirect(`/uploads/${id}`);
}

/** cancelamento lógico (ADMIN). */
export async function cancelarUpload(
  id: string,
  _estado: EstadoUpload,
  formData: FormData
): Promise<EstadoUpload> {
  const perfil = await exigirPerfil(["ADMIN"]);
  const motivo = String(formData.get("motivo") ?? "").trim();
  if (!motivo) return { erro: "O motivo do cancelamento é obrigatório." };

  const admin = criarClienteAdmin();
  const { data: imp } = await admin
    .from("imports")
    .select("id, status, report_date")
    .eq("id", id)
    .single();
  if (!imp) return { erro: "Upload não encontrado." };
  if (!["ATIVO", "COM_PENDENCIAS"].includes(imp.status)) {
    return { erro: "Somente uploads ativos podem ser cancelados." };
  }

  const { error } = await admin
    .from("imports")
    .update({
      status: "CANCELADO",
      cancellation_reason: motivo,
      cancelled_by: perfil.id,
      cancelled_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) return { erro: `Falha ao cancelar: ${error.message}` };

  await registrarAuditoria({
    userId: perfil.id,
    action: "IMPORT_CANCELLED",
    entityType: "IMPORT",
    entityId: id,
    before: { status: imp.status },
    reason: motivo,
  });

  const reproc = await reprocessarTudo(perfil, "cancelamento");
  if (!reproc.ok) console.error(reproc.mensagem);

  revalidatePath("/uploads");
  revalidatePath("/pendencias");
  redirect(`/uploads/${id}`);
}

/** restauração de upload cancelado (ADMIN). */
export async function restaurarUpload(
  id: string,
  _estado: EstadoUpload,
  formData: FormData
): Promise<EstadoUpload> {
  const perfil = await exigirPerfil(["ADMIN"]);
  const motivo = String(formData.get("motivo") ?? "").trim();
  if (!motivo) return { erro: "O motivo da restauração é obrigatório." };

  const admin = criarClienteAdmin();
  const { data: imp } = await admin
    .from("imports")
    .select("id, status, report_date")
    .eq("id", id)
    .single();
  if (!imp) return { erro: "Upload não encontrado." };
  if (imp.status !== "CANCELADO") {
    return { erro: "Somente uploads cancelados podem ser restaurados." };
  }

  // Conflito de versão ativa
  const { data: ativos } = await admin
    .from("imports")
    .select("id, version")
    .eq("report_date", imp.report_date)
    .in("status", ["ATIVO", "COM_PENDENCIAS"])
    .limit(1);
  if (ativos && ativos.length > 0) {
    return {
      erro: `Já existe uma versão ativa (v${ativos[0].version}) para esta data. Cancele-a antes de restaurar esta.`,
    };
  }

  const { error } = await admin
    .from("imports")
    .update({
      status: "ATIVO",
      cancellation_reason: null,
      cancelled_by: null,
      cancelled_at: null,
    })
    .eq("id", id);
  if (error) return { erro: `Falha ao restaurar: ${error.message}` };

  await registrarAuditoria({
    userId: perfil.id,
    action: "IMPORT_RESTORED",
    entityType: "IMPORT",
    entityId: id,
    reason: motivo,
  });

  const reproc = await reprocessarTudo(perfil, "restauracao");
  if (!reproc.ok) console.error(reproc.mensagem);

  revalidatePath("/uploads");
  revalidatePath("/pendencias");
  redirect(`/uploads/${id}`);
}

/** exclusão definitiva controlada (ADMIN). */
export async function excluirUpload(
  id: string,
  _estado: EstadoUpload,
  formData: FormData
): Promise<EstadoUpload> {
  const perfil = await exigirPerfil(["ADMIN"]);
  const motivo = String(formData.get("motivo") ?? "").trim();
  const frase = String(formData.get("frase") ?? "").trim();

  if (!motivo) return { erro: "O motivo da exclusão é obrigatório." };
  if (frase !== FRASE_EXCLUSAO) {
    return { erro: `Digite exatamente "${FRASE_EXCLUSAO}" para confirmar.` };
  }

  const admin = criarClienteAdmin();
  const { data: imp } = await admin
    .from("imports")
    .select("*")
    .eq("id", id)
    .single();
  if (!imp) return { erro: "Upload não encontrado." };

  // nunca excluir algo que gerou snapshots
  const { count } = await admin
    .from("client_snapshots")
    .select("id", { count: "exact", head: true })
    .eq("import_id", id);
  if ((count ?? 0) > 0) {
    return {
      erro: "Este upload gerou snapshots e não pode ser excluído definitivamente. Use o cancelamento.",
    };
  }
  if (["ATIVO", "COM_PENDENCIAS", "PROCESSANDO"].includes(imp.status)) {
    return { erro: "Uploads ativos não podem ser excluídos definitivamente." };
  }

  await admin.from("import_issues").delete().eq("import_id", id);
  await admin.from("import_rows").delete().eq("import_id", id);
  await admin.storage.from(BUCKET).remove([imp.file_storage_key]);
  const { error } = await admin
    .from("imports")
    .update({ status: "EXCLUIDO", error_message: null })
    .eq("id", id);
  if (error) return { erro: `Falha ao excluir: ${error.message}` };

  await registrarAuditoria({
    userId: perfil.id,
    action: "IMPORT_DELETED",
    entityType: "IMPORT",
    entityId: id,
    before: {
      file_name: imp.file_name,
      report_date: imp.report_date,
      status: imp.status,
      checksum: imp.checksum_sha256,
    },
    reason: motivo,
  });

  revalidatePath("/uploads");
  redirect("/uploads");
}

/** Volta um upload com ERRO (antes de confirmar) para PREVIA */
export async function tentarNovamente(id: string) {
  await exigirPerfil(["ADMIN", "MANAGER"]);
  const admin = criarClienteAdmin();

  const { count } = await admin
    .from("client_snapshots")
    .select("id", { count: "exact", head: true })
    .eq("import_id", id);
  if ((count ?? 0) > 0) return;

  await admin
    .from("imports")
    .update({ status: "PREVIA", error_message: null })
    .eq("id", id)
    .eq("status", "ERRO");

  revalidatePath(`/uploads/${id}`);
}

/** Descarta uma prévia não confirmada. */
export async function descartarPrevia(id: string) {
  const perfil = await exigirPerfil(["ADMIN", "MANAGER"]);
  const admin = criarClienteAdmin();

  const { data: imp } = await admin
    .from("imports")
    .select("*")
    .eq("id", id)
    .single();
  if (!imp) redirect("/uploads");
  if (imp.status !== "PREVIA" && imp.status !== "ERRO") redirect(`/uploads/${id}`);

  const { count } = await admin
    .from("client_snapshots")
    .select("id", { count: "exact", head: true })
    .eq("import_id", id);
  if ((count ?? 0) > 0) redirect(`/uploads/${id}`);

  await admin.from("import_issues").delete().eq("import_id", id);
  await admin.from("import_rows").delete().eq("import_id", id);
  await admin.from("imports").delete().eq("id", id);
  await admin.storage.from(BUCKET).remove([imp.file_storage_key]);

  await registrarAuditoria({
    userId: perfil.id,
    action: "IMPORT_PREVIEW_DISCARDED",
    entityType: "IMPORT",
    entityId: id,
    before: {
      file_name: imp.file_name,
      report_date: imp.report_date,
      status: imp.status,
    },
  });

  revalidatePath("/uploads");
  redirect("/uploads");
}

export interface EstadoRecalculo {
  ok?: string;
  erro?: string;
}

/** Recálculo manual (ADMIN) — idempotente, com retorno para a tela. */
export async function recalcularProducaoManual(
  _estado: EstadoRecalculo,
  _formData: FormData
): Promise<EstadoRecalculo> {
  const perfil = await exigirPerfil(["ADMIN"]);
  const resultado = await reprocessarTudo(perfil, "manual");

  revalidatePath("/uploads");
  revalidatePath("/pendencias");
  revalidatePath("/clientes");
  revalidatePath("/");

  return resultado.ok
    ? { ok: resultado.mensagem }
    : { erro: resultado.mensagem };
}
