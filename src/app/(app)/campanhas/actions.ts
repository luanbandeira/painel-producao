"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigirPerfil } from "@/lib/auth";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { registrarAuditoria } from "@/lib/audit";

export interface EstadoCampanha {
  erro?: string;
}

const METRICAS_META = [
  "VOLUME",
  "ORDERS",
  "NEW_CLIENTS",
  "PRODUCING_CLIENTS",
] as const;

function lerCampos(formData: FormData) {
  const metas: { metric: string; target_value: number }[] = [];
  for (const m of METRICAS_META) {
    const bruto = String(formData.get(`meta_${m}`) ?? "").trim();
    if (!bruto) continue;
    const valor = Number(bruto);
    if (Number.isFinite(valor) && valor > 0) {
      metas.push({ metric: m, target_value: valor });
    }
  }

  return {
    name: String(formData.get("name") ?? "").trim(),
    description: String(formData.get("description") ?? "").trim() || null,
    start_date: String(formData.get("start_date") ?? ""),
    end_date: String(formData.get("end_date") ?? ""),
    primary_metric: String(formData.get("primary_metric") ?? "VOLUME"),
    target_value: String(formData.get("target_value") ?? "").trim() || null,
    participantes: formData.getAll("participantes").map(String).filter(Boolean),
    metas,
  };
}

/** Regrava as metas individuais da campanha (substitui o conjunto). */
async function salvarMetas(
  admin: ReturnType<typeof criarClienteAdmin>,
  campaignId: string,
  metas: { metric: string; target_value: number }[]
) {
  await admin.from("campaign_goals").delete().eq("campaign_id", campaignId);
  if (metas.length > 0) {
    await admin.from("campaign_goals").insert(
      metas.map((m) => ({
        campaign_id: campaignId,
        metric: m.metric,
        target_value: m.target_value,
      }))
    );
  }
}

function validar(c: ReturnType<typeof lerCampos>): string | null {
  if (!c.name) return "O nome é obrigatório.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(c.start_date) || !/^\d{4}-\d{2}-\d{2}$/.test(c.end_date)) {
    return "Informe as datas de início e fim.";
  }
  if (c.end_date < c.start_date) return "A data final deve ser após a inicial.";
  if (!["VOLUME", "CLIENTS", "ORDERS"].includes(c.primary_metric)) {
    return "Métrica inválida.";
  }
  if (c.target_value !== null && !Number.isFinite(Number(c.target_value))) {
    return "A meta deve ser um número.";
  }
  return null;
}

export async function criarCampanha(
  _estado: EstadoCampanha,
  formData: FormData
): Promise<EstadoCampanha> {
  const perfil = await exigirPerfil(["ADMIN", "MANAGER"]);
  const campos = lerCampos(formData);
  const erro = validar(campos);
  if (erro) return { erro };

  const admin = criarClienteAdmin();
  const { participantes, metas, ...registro } = campos;
  const { data, error } = await admin
    .from("campaigns")
    .insert({ ...registro, status: "RASCUNHO", created_by: perfil.id })
    .select("id")
    .single();
  if (error || !data) return { erro: `Falha ao criar: ${error?.message}` };

  if (participantes.length > 0) {
    await admin.from("campaign_sellers").insert(
      participantes.map((sellerId) => ({
        campaign_id: data.id,
        seller_id: sellerId,
      }))
    );
  }
  await salvarMetas(admin, data.id, metas);

  await registrarAuditoria({
    userId: perfil.id,
    action: "CAMPAIGN_CREATED",
    entityType: "CAMPAIGN",
    entityId: data.id,
    after: { ...registro, participantes, metas },
  });

  revalidatePath("/campanhas");
  redirect(`/campanhas/${data.id}`);
}

export async function atualizarCampanha(
  id: string,
  _estado: EstadoCampanha,
  formData: FormData
): Promise<EstadoCampanha> {
  const perfil = await exigirPerfil(["ADMIN", "MANAGER"]);
  const campos = lerCampos(formData);
  const erro = validar(campos);
  if (erro) return { erro };

  const admin = criarClienteAdmin();
  const { data: atual } = await admin
    .from("campaigns")
    .select("*")
    .eq("id", id)
    .single();
  if (!atual) return { erro: "Campanha não encontrada." };
  if (atual.status === "ENCERRADA" || atual.status === "CANCELADA") {
    return { erro: "Campanhas encerradas só podem ser alteradas após reabertura por um administrador." };
  }

  const { participantes, metas, ...registro } = campos;
  const { error } = await admin
    .from("campaigns")
    .update({ ...registro, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { erro: `Falha ao salvar: ${error.message}` };

  await admin.from("campaign_sellers").delete().eq("campaign_id", id);
  if (participantes.length > 0) {
    await admin.from("campaign_sellers").insert(
      participantes.map((sellerId) => ({
        campaign_id: id,
        seller_id: sellerId,
      }))
    );
  }
  await salvarMetas(admin, id, metas);

  await registrarAuditoria({
    userId: perfil.id,
    action: "CAMPAIGN_UPDATED",
    entityType: "CAMPAIGN",
    entityId: id,
    before: atual,
    after: { ...registro, participantes, metas },
  });

  revalidatePath("/campanhas");
  redirect(`/campanhas/${id}`);
}

async function mudarStatus(
  id: string,
  de: string[],
  para: string,
  acao: string,
  extras: Record<string, unknown> = {}
) {
  const admin = criarClienteAdmin();
  const { data: atual } = await admin
    .from("campaigns")
    .select("id, status, closing_version")
    .eq("id", id)
    .single();
  if (!atual || !de.includes(atual.status)) return null;
  await admin
    .from("campaigns")
    .update({ status: para, updated_at: new Date().toISOString(), ...extras })
    .eq("id", id);
  return { statusAnterior: atual.status, closingVersion: atual.closing_version };
}

export async function iniciarCampanha(id: string) {
  const perfil = await exigirPerfil(["ADMIN", "MANAGER"]);
  const r = await mudarStatus(id, ["RASCUNHO"], "ATIVA", "start");
  if (r) {
    await registrarAuditoria({
      userId: perfil.id,
      action: "CAMPAIGN_STARTED",
      entityType: "CAMPAIGN",
      entityId: id,
    });
  }
  revalidatePath(`/campanhas/${id}`);
  revalidatePath("/campanhas");
}

/** encerramento bloqueia resultados e versiona o fechamento. */
export async function encerrarCampanha(id: string) {
  const perfil = await exigirPerfil(["ADMIN", "MANAGER"]);
  const admin = criarClienteAdmin();
  const { data: atual } = await admin
    .from("campaigns")
    .select("closing_version, status")
    .eq("id", id)
    .single();
  if (atual && atual.status === "ATIVA") {
    await admin
      .from("campaigns")
      .update({
        status: "ENCERRADA",
        closed_at: new Date().toISOString(),
        closing_version: (atual.closing_version ?? 0) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    await registrarAuditoria({
      userId: perfil.id,
      action: "CAMPAIGN_CLOSED",
      entityType: "CAMPAIGN",
      entityId: id,
      after: { closing_version: (atual.closing_version ?? 0) + 1 },
    });
  }
  revalidatePath(`/campanhas/${id}`);
  revalidatePath("/campanhas");
}

/**
 * Cancelamento exige administrador e motivo.
 *
 * Cancelada é o arquivo morto da campanha: sai da vista de todo mundo menos
 * da gestão (RLS, migration 00009) e não volta a ser editada. Serve para
 * campanha criada por engano ou duplicada — nada é apagado, e o motivo fica
 * na auditoria. Reverter é decisão consciente: reabrir só a partir de
 * ENCERRADA, então uma cancelada por engano precisa ser recriada.
 */
export async function cancelarCampanha(
  id: string,
  _anterior: { erro?: string; ok?: boolean },
  dados: FormData
) {
  const perfil = await exigirPerfil(["ADMIN"]);
  const motivo = String(dados.get("motivo") ?? "").trim();
  if (motivo.length < 5) {
    return { erro: "Informe o motivo do cancelamento (mínimo 5 caracteres)." };
  }

  const r = await mudarStatus(
    id,
    ["RASCUNHO", "ATIVA", "ENCERRADA"],
    "CANCELADA",
    "cancel"
  );
  if (!r) {
    return { erro: "Esta campanha não pode ser cancelada no status atual." };
  }

  await registrarAuditoria({
    userId: perfil.id,
    action: "CAMPAIGN_CANCELED",
    entityType: "CAMPAIGN",
    entityId: id,
    before: { status: r.statusAnterior },
    after: { status: "CANCELADA" },
    reason: motivo,
  });

  revalidatePath(`/campanhas/${id}`);
  revalidatePath("/campanhas");
  return { ok: true };
}

/** Reabertura exige administrador. */
export async function reabrirCampanha(id: string) {
  const perfil = await exigirPerfil(["ADMIN"]);
  const r = await mudarStatus(id, ["ENCERRADA"], "ATIVA", "reopen");
  if (r) {
    await registrarAuditoria({
      userId: perfil.id,
      action: "CAMPAIGN_REOPENED",
      entityType: "CAMPAIGN",
      entityId: id,
    });
  }
  revalidatePath(`/campanhas/${id}`);
  revalidatePath("/campanhas");
}
