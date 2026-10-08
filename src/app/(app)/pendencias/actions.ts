"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigirPerfil } from "@/lib/auth";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { registrarAuditoria } from "@/lib/audit";
import { normalizarNome } from "@/lib/normalizacao";
import {
  processarAtribuicoesDosUploads,
  transferirCliente,
} from "@/lib/atribuicoes";
import { recalcularProducao } from "@/lib/calculo/persistencia";

export interface EstadoResolucao {
  erro?: string;
  ok?: string;
}

async function reprocessar() {
  try {
    await processarAtribuicoesDosUploads();
    await recalcularProducao();
  } catch (e) {
    console.error("Falha no reprocessamento pós-resolução:", e);
  }
}

/**
 * Resolução em lote, só quando é seguro.
 *
 * Só admite decisões sem efeito sobre os números: marcar como resolvida ou
 * ignorar. Pendências BLOQUEANTES ficam de fora — delta negativo e afins
 * exigem decisão administrativa individual.
 */
export async function resolverEmLote(
  _estado: EstadoResolucao,
  formData: FormData
): Promise<EstadoResolucao> {
  const perfil = await exigirPerfil(["ADMIN", "MANAGER"]);

  const ids = formData.getAll("issue_ids").map(String).filter(Boolean);
  const acao = String(formData.get("acao") ?? "");
  const justificativa = String(formData.get("justificativa") ?? "").trim();

  if (ids.length === 0) return { erro: "Selecione ao menos uma pendência." };
  if (!["RESOLVER", "IGNORAR"].includes(acao)) {
    return { erro: "Escolha o que fazer com as pendências selecionadas." };
  }

  const admin = criarClienteAdmin();
  const { data: issues, error: erroBusca } = await admin
    .from("import_issues")
    .select("id, type, severity, status")
    .in("id", ids);
  if (erroBusca) return { erro: `Falha ao carregar pendências: ${erroBusca.message}` };

  const abertas = (issues ?? []).filter((i) => i.status === "OPEN");
  if (abertas.some((i) => i.severity === "BLOCKING")) {
    return {
      erro: "A seleção contém pendências bloqueantes, que exigem decisão individual. Remova-as da seleção.",
    };
  }
  if (abertas.length === 0) {
    return { erro: "Nenhuma das pendências selecionadas continua aberta." };
  }

  const status = acao === "IGNORAR" ? "IGNORED" : "RESOLVED";
  const { error } = await admin
    .from("import_issues")
    .update({
      status,
      resolution: {
        action: acao === "IGNORAR" ? "IGNORED" : "RESOLVED_MANUALLY",
        justification: justificativa || null,
        bulk: true,
      },
      resolved_by: perfil.id,
      resolved_at: new Date().toISOString(),
    })
    .in(
      "id",
      abertas.map((i) => i.id)
    )
    .eq("status", "OPEN");
  if (error) return { erro: `Falha ao gravar as resoluções: ${error.message}` };

  await registrarAuditoria({
    userId: perfil.id,
    action: "ISSUES_BULK_RESOLVED",
    entityType: "IMPORT_ISSUE",
    after: {
      quantidade: abertas.length,
      acao: status,
      tipos: [...new Set(abertas.map((i) => i.type))],
      ids: abertas.map((i) => i.id),
    },
    reason: justificativa || undefined,
  });

  revalidatePath("/pendencias");
  return {
    ok: `${abertas.length} pendência(s) ${status === "IGNORED" ? "ignorada(s)" : "resolvida(s)"}.`,
  };
}

/**
 * Resolve uma pendência. As opções dependem do tipo:
 * - UNKNOWN_SELLER: vincular alias, criar vendedor ou ignorar
 * - SELLER_CHANGE: manter, transferir ou ignorar
 * - NO_BASE: confirmar base zero (admin), manter sem base ou ignorar
 * - NEGATIVE_*: classificar como correção da fonte (admin) ou ignorar
 * - demais: resolver com nota ou ignorar
 */
export async function resolverPendencia(
  issueId: string,
  _estado: EstadoResolucao,
  formData: FormData
): Promise<EstadoResolucao> {
  const perfil = await exigirPerfil(["ADMIN", "MANAGER"]);
  const admin = criarClienteAdmin();

  const { data: issue } = await admin
    .from("import_issues")
    .select("*")
    .eq("id", issueId)
    .single();
  if (!issue) return { erro: "Pendência não encontrada." };
  if (issue.status !== "OPEN") return { erro: "Esta pendência já foi tratada." };

  const acao = String(formData.get("acao") ?? "");
  const justificativa = String(formData.get("justificativa") ?? "").trim();
  const detalhes = (issue.details ?? {}) as Record<string, unknown>;

  let resolution: Record<string, unknown> = { action: acao };
  let statusFinal: "RESOLVED" | "IGNORED" = "RESOLVED";
  let precisaReprocessar = false;

  const somenteAdmin = () =>
    perfil.role !== "ADMIN"
      ? { erro: "Esta decisão exige um administrador." }
      : null;

  switch (`${issue.type}:${acao}`) {
    case "UNKNOWN_SELLER:VINCULAR_ALIAS": {
      const sellerId = String(formData.get("seller_id") ?? "");
      if (!sellerId) return { erro: "Escolha o vendedor." };
      const texto = String(detalhes.texto ?? "");
      const { error } = await admin.from("seller_aliases").insert({
        seller_id: sellerId,
        alias: texto,
        normalized_alias: normalizarNome(texto),
      });
      if (error && !error.message.includes("duplicate")) {
        return { erro: `Falha ao criar alias: ${error.message}` };
      }
      resolution = { action: acao, seller_id: sellerId, alias: texto };
      precisaReprocessar = true;
      break;
    }

    case "UNKNOWN_SELLER:CRIAR_VENDEDOR": {
      const bloqueio = somenteAdmin();
      if (bloqueio) return bloqueio;
      const texto = String(detalhes.texto ?? "");
      const { data: novo, error } = await admin
        .from("sellers")
        .insert({ name: texto, normalized_name: normalizarNome(texto) })
        .select("id")
        .single();
      if (error) return { erro: `Falha ao criar vendedor: ${error.message}` };
      resolution = { action: acao, seller_id: novo.id, name: texto };
      precisaReprocessar = true;
      break;
    }

    case "SELLER_CHANGE:MANTER":
      resolution = { action: "KEEP_CURRENT", justification: justificativa };
      break;

    case "SELLER_CHANGE:TRANSFERIR": {
      const dataEfetiva =
        String(formData.get("effective_date") ?? "") ||
        String(detalhes.report_date ?? "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dataEfetiva)) {
        return { erro: "Informe a data efetiva da transferência." };
      }
      if (!justificativa) {
        return { erro: "O motivo é obrigatório em transferências." };
      }
      const resultado = await transferirCliente({
        clientId: issue.client_id,
        novoSellerId: String(detalhes.suggested_seller_id ?? ""),
        dataEfetiva,
        motivo: justificativa,
        protegida: false,
        userId: perfil.id,
      });
      if (resultado.erro) return { erro: resultado.erro };
      resolution = {
        action: acao,
        effective_date: dataEfetiva,
        seller_id: detalhes.suggested_seller_id,
        justification: justificativa,
      };
      precisaReprocessar = true;
      break;
    }

    case "NO_BASE:BASE_ZERO": {
      const bloqueio = somenteAdmin(); // só admin confirma base zero
      if (bloqueio) return bloqueio;
      if (!justificativa) {
        return { erro: "A justificativa é obrigatória para base zero." };
      }
      resolution = { action: "BASE_ZERO", justification: justificativa };
      precisaReprocessar = true;
      break;
    }

    case "NO_BASE:MANTER_SEM_BASE":
      resolution = { action: "KEEP_NO_BASE", justification: justificativa };
      break;

    case "NEGATIVE_VOLUME:CORRECAO_FONTE":
    case "NEGATIVE_ORDERS:CORRECAO_FONTE": {
      const bloqueio = somenteAdmin(); // decisão administrativa
      if (bloqueio) return bloqueio;
      if (!justificativa) {
        return { erro: "A justificativa é obrigatória." };
      }
      resolution = { action: "SOURCE_CORRECTION", justification: justificativa };
      precisaReprocessar = true; // libera o status do upload
      break;
    }

    default: {
      if (acao === "IGNORAR") {
        if (issue.severity === "BLOCKING") {
          const bloqueio = somenteAdmin();
          if (bloqueio) return bloqueio;
        }
        statusFinal = "IGNORED";
        resolution = { action: "IGNORED", justification: justificativa };
        precisaReprocessar = issue.severity === "BLOCKING";
        break;
      }
      if (acao === "RESOLVER") {
        resolution = { action: "RESOLVED_MANUALLY", justification: justificativa };
        break;
      }
      return { erro: "Ação inválida para este tipo de pendência." };
    }
  }

  const { error: erroUpdate } = await admin
    .from("import_issues")
    .update({
      status: statusFinal,
      resolution,
      resolved_by: perfil.id,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", issueId)
    .eq("status", "OPEN");
  if (erroUpdate) return { erro: `Falha ao gravar a resolução: ${erroUpdate.message}` };

  await registrarAuditoria({
    userId: perfil.id,
    action: "ISSUE_RESOLVED",
    entityType: "IMPORT_ISSUE",
    entityId: issueId,
    before: { type: issue.type, severity: issue.severity },
    after: resolution,
    reason: justificativa || undefined,
  });

  if (precisaReprocessar) await reprocessar();

  revalidatePath("/pendencias");
  revalidatePath("/uploads");
  redirect("/pendencias");
}
