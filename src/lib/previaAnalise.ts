import { criarClienteAdmin } from "@/lib/supabase/admin";
import { normalizarNome } from "@/lib/normalizacao";
import { avaliarPrevia, type Veredito } from "@/lib/previaUpload";
import type { LinhaNormalizada } from "@/lib/importacao/parser";

/**
 * Tudo o que se sabe sobre uma prévia antes de confirmá-la.
 *
 * Mora aqui, e não na página, porque dois lugares precisam da mesma leitura:
 * a tela de prévia e a confirmação automática do upload. Se cada um contasse
 * por conta própria, o sistema poderia confirmar sozinho um arquivo que a
 * tela apontaria como digno de atenção.
 *
 * Usa o cliente admin: os dois chamadores rodam depois de
 * `exigirPerfil(["ADMIN", "MANAGER"])`.
 */

export interface LinhaPrevia {
  numero: number;
  status: string;
  nd: LinhaNormalizada;
}

export interface AnalisePrevia {
  linhas: LinhaPrevia[];
  /** Clientes que ainda não existem na base. */
  novos: LinhaPrevia[];
  /** Estavam na base anterior e não vieram neste arquivo. */
  ausentes: { codigo: string; nome: string }[];
  semVendedor: LinhaPrevia[];
  desconhecidos: { nome: string; clientes: number }[];
  negativos: { linha: LinhaPrevia; anterior: { volume: number; tx: number } }[];
  comProblema: LinhaPrevia[];
  base: {
    id: string;
    report_date: string;
    coverage_end_date: string;
    file_name: string;
  } | null;
  volumeTotal: number;
  /** Preenchido só quando a prévia substitui uma versão ativa. */
  versaoAnterior: {
    version: number;
    file_name: string;
    linhas: number;
    volume: number;
  } | null;
  veredito: Veredito;
}

export async function analisarPrevia(importId: string): Promise<AnalisePrevia> {
  const admin = criarClienteAdmin();

  const { data: imp } = await admin
    .from("imports")
    .select("id, coverage_end_date, replaced_import_id")
    .eq("id", importId)
    .single();

  const [linhasRes, selleresRes, aliasesRes, baseRes] = await Promise.all([
    admin
      .from("import_rows")
      .select("row_number, status, normalized_data")
      .eq("import_id", importId)
      .order("row_number"),
    admin.from("sellers").select("normalized_name"),
    admin.from("seller_aliases").select("normalized_alias"),
    admin
      .from("imports")
      .select("id, report_date, coverage_end_date, file_name")
      .in("status", ["ATIVO", "COM_PENDENCIAS"])
      .lt("coverage_end_date", imp?.coverage_end_date ?? "")
      .order("coverage_end_date", { ascending: false })
      .limit(1),
  ]);

  const linhas: LinhaPrevia[] = (linhasRes.data ?? []).map((r) => ({
    numero: r.row_number as number,
    status: r.status as string,
    nd: r.normalized_data as LinhaNormalizada,
  }));

  const codigosArquivo = linhas
    .map((l) => l.nd.client_code)
    .filter(Boolean) as string[];

  const { data: existentes } = await admin
    .from("clients")
    .select("client_code")
    .in("client_code", codigosArquivo);
  const codigosExistentes = new Set(
    (existentes ?? []).map((c) => c.client_code)
  );

  const base = baseRes.data?.[0] ?? null;
  const snapshotsBase = new Map<string, { volume: number; tx: number; nome: string }>();
  if (base) {
    const { data: snaps } = await admin
      .from("client_snapshots")
      .select(
        "cumulative_volume, cumulative_orders, client:clients(client_code, display_name)"
      )
      .eq("import_id", base.id)
      .eq("status", "ACTIVE");
    for (const s of snaps ?? []) {
      const cliente = s.client as unknown as {
        client_code: string;
        display_name: string;
      } | null;
      if (cliente) {
        snapshotsBase.set(cliente.client_code, {
          volume: Number(s.cumulative_volume),
          tx: Number(s.cumulative_orders),
          nome: cliente.display_name,
        });
      }
    }
  }

  const nomesConhecidos = new Set([
    ...(selleresRes.data ?? []).map((p) => p.normalized_name),
    ...(aliasesRes.data ?? []).map((a) => a.normalized_alias),
  ]);

  const novos = linhas.filter(
    (l) => l.nd.client_code && !codigosExistentes.has(l.nd.client_code)
  );
  const semVendedor = linhas.filter((l) => !l.nd.seller_text);

  const contagem = new Map<string, number>();
  for (const l of linhas) {
    if (l.nd.seller_text && !nomesConhecidos.has(normalizarNome(l.nd.seller_text))) {
      contagem.set(l.nd.seller_text, (contagem.get(l.nd.seller_text) ?? 0) + 1);
    }
  }
  const desconhecidos = [...contagem.entries()].map(([nome, clientes]) => ({
    nome,
    clientes,
  }));

  const ausentes = base
    ? [...snapshotsBase.entries()]
        .filter(([codigo]) => !codigosArquivo.includes(codigo))
        .map(([codigo, s]) => ({ codigo, nome: s.nome }))
    : [];

  const negativos = linhas
    .map((linha) => {
      const anterior = linha.nd.client_code
        ? snapshotsBase.get(linha.nd.client_code)
        : undefined;
      return anterior &&
        ((linha.nd.cumulative_volume ?? 0) < anterior.volume ||
          (linha.nd.cumulative_orders ?? 0) < anterior.tx)
        ? { linha, anterior: { volume: anterior.volume, tx: anterior.tx } }
        : null;
    })
    .filter((x): x is { linha: LinhaPrevia; anterior: { volume: number; tx: number } } => x !== null);

  const comProblema = linhas.filter((l) => l.nd.problemas.length > 0);
  const volumeTotal = linhas.reduce((s, l) => s + (l.nd.cumulative_volume ?? 0), 0);

  // Comparação com a versão que será substituída
  let versaoAnterior: AnalisePrevia["versaoAnterior"] = null;
  if (imp?.replaced_import_id) {
    const [{ data: antigo }, { data: snapsAntigos }] = await Promise.all([
      admin
        .from("imports")
        .select("version, file_name")
        .eq("id", imp.replaced_import_id)
        .single(),
      admin
        .from("client_snapshots")
        .select("cumulative_volume")
        .eq("import_id", imp.replaced_import_id),
    ]);
    if (antigo) {
      versaoAnterior = {
        version: antigo.version,
        file_name: antigo.file_name,
        linhas: (snapsAntigos ?? []).length,
        volume: (snapsAntigos ?? []).reduce((s, x) => s + Number(x.cumulative_volume), 0),
      };
    }
  }

  return {
    linhas,
    novos,
    ausentes,
    semVendedor,
    desconhecidos,
    negativos,
    comProblema,
    base,
    volumeTotal,
    versaoAnterior,
    veredito: avaliarPrevia({
      linhas: linhas.length,
      novos: novos.length,
      ausentes: ausentes.length,
      semVendedor: semVendedor.length,
      desconhecidos: desconhecidos.length,
      negativos: negativos.length,
      comProblema: comProblema.length,
      temBase: base !== null,
    }),
  };
}
