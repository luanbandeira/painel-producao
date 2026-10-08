import { criarClienteAdmin } from "@/lib/supabase/admin";
import { normalizarNome } from "@/lib/normalizacao";
import { somarDias } from "@/lib/calculo/motor";
import { planejarCorrecaoInicio, type Passo } from "@/lib/correcaoInicio";

/**
 * Processamento de atribuições vindas dos uploads e
 * transferências manuais. Idempotente: atribuições só são criadas
 * quando o cliente não possui vigente, e pendências nunca são duplicadas.
 */

const PAGINA = 1000;

async function buscarTudo<T>(
  consulta: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const tudo: T[] = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await consulta(de, de + PAGINA - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    tudo.push(...data);
    if (data.length < PAGINA) break;
  }
  return tudo;
}

export interface ResumoAtribuicoes {
  criadas: number;
  conflitos: number;
  desconhecidos: number;
  obsoletasFechadas: number;
}

/**
 * Processa as atribuições sugeridas pelos uploads ativos, em ordem de
 * cobertura. Regras:
 *  - texto vazio: mantém o que existe, sem ação;
 *  - nome reconhecido + cliente sem responsável: cria atribuição UPLOAD;
 *  - nome reconhecido igual ao vigente: considerada verificada;
 *  - nome reconhecido diferente do vigente: pendência de conflito, nunca troca
 *    silenciosa;
 *  - nome não reconhecido: pendência de vendedor desconhecido.
 */
export async function processarAtribuicoesDosUploads(): Promise<ResumoAtribuicoes> {
  const admin = criarClienteAdmin();

  const { data: imports, error: erroImports } = await admin
    .from("imports")
    .select("id, coverage_end_date, report_date")
    .in("status", ["ATIVO", "COM_PENDENCIAS"])
    .order("coverage_end_date", { ascending: true });
  if (erroImports) throw new Error(erroImports.message);

  const [selleres, aliases, vigentes, issuesExistentes] = await Promise.all([
    buscarTudo<{ id: string; normalized_name: string; active: boolean }>((de, ate) =>
      admin.from("sellers").select("id, normalized_name, active").order("id").range(de, ate)
    ),
    buscarTudo<{ seller_id: string; normalized_alias: string }>((de, ate) =>
      admin.from("seller_aliases").select("seller_id, normalized_alias").order("id").range(de, ate)
    ),
    buscarTudo<{ id: string; client_id: string; seller_id: string; protected: boolean }>((de, ate) =>
      admin
        .from("client_assignments")
        .select("id, client_id, seller_id, protected")
        .eq("status", "ACTIVE")
        .is("valid_until", null)
        .order("id")
        .range(de, ate)
    ),
    buscarTudo<{
      id: string;
      import_id: string;
      client_id: string | null;
      type: string;
      status: string;
      details: Record<string, unknown> | null;
    }>((de, ate) =>
      admin
        .from("import_issues")
        .select("id, import_id, client_id, type, status, details")
        .order("id")
        .range(de, ate)
    ),
  ]);

  // Nome normalizado -> vendedor (nomes oficiais têm precedência sobre aliases)
  const porNome = new Map<string, string>();
  for (const a of aliases) porNome.set(a.normalized_alias, a.seller_id);
  for (const p of selleres) porNome.set(p.normalized_name, p.id);

  const atuais = new Map(vigentes.map((v) => [v.client_id, v]));
  const chavesIssues = new Set(
    issuesExistentes.map((i) => `${i.import_id}|${i.client_id}|${i.type}`)
  );

  // Pendências que deixaram de fazer sentido depois de uma resolução anterior:
  // o nome virou alias/vendedor conhecido, ou o conflito já foi transferido.
  // Sem isso a fila acumula itens obsoletos indefinidamente, escondendo o que
  // realmente precisa de decisão humana.
  const obsoletasNome: string[] = [];
  const obsoletasConflito: string[] = [];
  for (const i of issuesExistentes) {
    if (i.status !== "OPEN") continue;
    if (i.type === "UNKNOWN_SELLER") {
      const texto = i.details?.texto;
      if (typeof texto === "string" && porNome.has(normalizarNome(texto))) {
        obsoletasNome.push(i.id);
      }
    } else if (i.type === "SELLER_CHANGE" && i.client_id) {
      const sugerido = i.details?.suggested_seller_id;
      const vigente = atuais.get(i.client_id);
      if (
        typeof sugerido === "string" &&
        vigente &&
        vigente.seller_id === sugerido
      ) {
        obsoletasConflito.push(i.id);
      }
    }
  }

  const novasAtribuicoes: Record<string, unknown>[] = [];
  const novasIssues: Record<string, unknown>[] = [];
  let conflitos = 0;
  let desconhecidos = 0;

  for (const imp of imports ?? []) {
    const snaps = await buscarTudo<{
      client_id: string;
      source_seller_text: string | null;
    }>((de, ate) =>
      admin
        .from("client_snapshots")
        .select("client_id, source_seller_text")
        .eq("import_id", imp.id)
        .eq("status", "ACTIVE")
        .order("id")
        .range(de, ate)
    );

    for (const s of snaps) {
      const texto = s.source_seller_text?.trim();
      if (!texto) continue;

      const sellerId = porNome.get(normalizarNome(texto));
      const vigente = atuais.get(s.client_id);

      if (!sellerId) {
        // não criar vendedor silenciosamente
        const chave = `${imp.id}|${s.client_id}|UNKNOWN_SELLER`;
        if (!chavesIssues.has(chave)) {
          chavesIssues.add(chave);
          desconhecidos++;
          novasIssues.push({
            import_id: imp.id,
            client_id: s.client_id,
            type: "UNKNOWN_SELLER",
            severity: "WARNING",
            status: "OPEN",
            details: { texto, report_date: imp.report_date },
          });
        }
        continue;
      }

      if (!vigente) {
        // primeira atribuição vinda da planilha
        novasAtribuicoes.push({
          client_id: s.client_id,
          seller_id: sellerId,
          valid_from: imp.coverage_end_date,
          origin: "UPLOAD",
          status: "ACTIVE",
          protected: false,
        });
        atuais.set(s.client_id, {
          id: "nova",
          client_id: s.client_id,
          seller_id: sellerId,
          protected: false,
        });
        continue;
      }

      if (vigente.seller_id !== sellerId) {
        // divergência nunca troca automaticamente
        const chave = `${imp.id}|${s.client_id}|SELLER_CHANGE`;
        if (!chavesIssues.has(chave)) {
          chavesIssues.add(chave);
          conflitos++;
          novasIssues.push({
            import_id: imp.id,
            client_id: s.client_id,
            type: "SELLER_CHANGE",
            severity: "WARNING",
            status: "OPEN",
            details: {
              texto,
              current_seller_id: vigente.seller_id,
              suggested_seller_id: sellerId,
              protected: vigente.protected,
              report_date: imp.report_date,
              coverage_end_date: imp.coverage_end_date,
            },
          });
        }
      }
      // mesmo responsável — verificado, nada a fazer
    }
  }

  for (let de = 0; de < novasAtribuicoes.length; de += 200) {
    const lote = novasAtribuicoes.slice(de, de + 200);
    const { error } = await admin.from("client_assignments").insert(lote);
    if (error) {
      // Fallback linha a linha (ex.: conflito de sobreposição isolado)
      for (const registro of lote) {
        await admin.from("client_assignments").insert(registro);
      }
    }
  }
  for (let de = 0; de < novasIssues.length; de += 200) {
    const { error } = await admin
      .from("import_issues")
      .insert(novasIssues.slice(de, de + 200));
    if (error) throw new Error(`Falha ao gravar pendências: ${error.message}`);
  }

  const agora = new Date().toISOString();
  for (const [ids, motivo] of [
    [obsoletasNome, "Nome passou a ser reconhecido por cadastro ou alias."],
    [obsoletasConflito, "O responsável sugerido já é o responsável vigente."],
  ] as const) {
    for (let de = 0; de < ids.length; de += 200) {
      await admin
        .from("import_issues")
        .update({
          status: "RESOLVED",
          resolution: { action: "AUTO_RESOLVED", reason: motivo },
          resolved_at: agora,
        })
        .in("id", ids.slice(de, de + 200))
        .eq("status", "OPEN");
    }
  }

  return {
    criadas: novasAtribuicoes.length,
    conflitos,
    desconhecidos,
    obsoletasFechadas: obsoletasNome.length + obsoletasConflito.length,
  };
}

export interface DadosTransferencia {
  clientId: string;
  novoSellerId: string;
  dataEfetiva: string; // yyyy-mm-dd
  motivo: string;
  protegida: boolean;
  userId: string;
}

/**
 * Transfere um cliente encerrando a atribuição vigente sem apagar o
 * histórico. A anterior termina no dia anterior à data
 * efetiva; a nova começa na data efetiva.
 */
export async function transferirCliente(dados: DadosTransferencia): Promise<{ erro?: string }> {
  const admin = criarClienteAdmin();

  const { data: vigente } = await admin
    .from("client_assignments")
    .select("id, seller_id, valid_from")
    .eq("client_id", dados.clientId)
    .eq("status", "ACTIVE")
    .is("valid_until", null)
    .maybeSingle();

  if (vigente) {
    if (vigente.seller_id === dados.novoSellerId) {
      return { erro: "O cliente já pertence a este vendedor." };
    }
    if (dados.dataEfetiva <= vigente.valid_from) {
      return {
        erro: `A data efetiva deve ser posterior ao início da atribuição atual (${vigente.valid_from}).`,
      };
    }
    const { error: erroFechar } = await admin
      .from("client_assignments")
      .update({ valid_until: somarDias(dados.dataEfetiva, -1) })
      .eq("id", vigente.id);
    if (erroFechar) return { erro: `Falha ao encerrar a atribuição atual: ${erroFechar.message}` };
  }

  const { error: erroCriar } = await admin.from("client_assignments").insert({
    client_id: dados.clientId,
    seller_id: dados.novoSellerId,
    valid_from: dados.dataEfetiva,
    origin: "MANUAL",
    status: "ACTIVE",
    protected: dados.protegida,
    reason: dados.motivo,
    created_by: dados.userId,
  });
  if (erroCriar) {
    // Reabre a anterior para não deixar o cliente órfão
    if (vigente) {
      await admin
        .from("client_assignments")
        .update({ valid_until: null })
        .eq("id", vigente.id);
    }
    return { erro: `Falha ao criar a nova atribuição: ${erroCriar.message}` };
  }

  return {};
}

/**
 * Corrige a data de início do responsável vigente — a saída para uma
 * transferência feita com a data errada, que `transferirCliente` não permite
 * desfazer (só aceita data posterior ao início atual).
 *
 * O que muda é decidido por `planejarCorrecaoInicio`, função pura e testada;
 * aqui só se executa o plano. Sem transação multi-requisição na API do
 * Supabase, cada passo tem o seu "desfazer", aplicado em ordem inversa se um
 * passo seguinte falhar — o mesmo recurso de `transferirCliente`.
 */
export async function corrigirInicioResponsavel(dados: {
  clientId: string;
  novaData: string;
}): Promise<{
  erro?: string;
  antes?: Record<string, unknown>;
  depois?: Record<string, unknown>;
}> {
  const admin = criarClienteAdmin();

  const { data: ativas, error } = await admin
    .from("client_assignments")
    .select("id, seller_id, valid_from, valid_until")
    .eq("client_id", dados.clientId)
    .eq("status", "ACTIVE");
  if (error) return { erro: `Falha ao ler o histórico: ${error.message}` };

  const vigente = (ativas ?? []).find((a) => a.valid_until === null);
  if (!vigente) return { erro: "Este cliente não tem responsável vigente para corrigir." };

  // A atribuição que a transferência encerrou termina na véspera da vigente
  const vesperaDaVigente = somarDias(vigente.valid_from, -1);
  const anterior =
    (ativas ?? []).find(
      (a) => a.id !== vigente.id && a.valid_until === vesperaDaVigente
    ) ?? null;

  const plano = planejarCorrecaoInicio({ vigente, anterior, novaData: dados.novaData });
  if ("erro" in plano) return { erro: plano.erro };

  const feitos: Passo[] = [];
  for (const passo of plano.passos) {
    const { error: erroPasso } = await admin
      .from("client_assignments")
      .update(passo.mudanca)
      .eq("id", passo.id);

    if (erroPasso) {
      for (const f of [...feitos].reverse()) {
        await admin.from("client_assignments").update(f.desfazer).eq("id", f.id);
      }
      // 23P01: a trava de períodos sobrepostos
      return {
        erro:
          erroPasso.code === "23P01"
            ? "A nova data se sobrepõe a outro período do histórico deste cliente."
            : `Falha ao corrigir: ${erroPasso.message}`,
      };
    }
    feitos.push(passo);
  }

  return {
    antes: {
      vigente: { id: vigente.id, seller_id: vigente.seller_id, valid_from: vigente.valid_from },
      anterior: anterior && {
        id: anterior.id,
        seller_id: anterior.seller_id,
        valid_from: anterior.valid_from,
        valid_until: anterior.valid_until,
      },
    },
    depois: {
      efeito: plano.efeito,
      passos: plano.passos.map((p) => ({ id: p.id, ...p.mudanca })),
    },
  };
}

/**
 * Nomes de vendedor que a planilha já trouxe e que não pertencem a
 * ninguém — nem como nome oficial, nem como alias.
 *
 * Serve para o cadastro sugerir o nome exato da fonte em vez de o
 * administrador digitá-lo de memória. Errar uma letra aqui é o que faz a
 * atribuição automática falhar e virar pendência.
 */
export async function nomesDaPlanilhaSemDono(): Promise<string[]> {
  const admin = criarClienteAdmin();

  const [selleres, aliases, snapshots] = await Promise.all([
    buscarTudo<{ normalized_name: string }>((de, ate) =>
      admin.from("sellers").select("normalized_name").order("id").range(de, ate)
    ),
    buscarTudo<{ normalized_alias: string }>((de, ate) =>
      admin
        .from("seller_aliases")
        .select("normalized_alias")
        .order("id")
        .range(de, ate)
    ),
    buscarTudo<{ source_seller_text: string | null }>((de, ate) =>
      admin
        .from("client_snapshots")
        .select("source_seller_text, imports!inner(status)")
        .eq("status", "ACTIVE")
        .in("imports.status", ["ATIVO", "COM_PENDENCIAS"])
        .order("id")
        .range(de, ate)
    ),
  ]);

  const conhecidos = new Set<string>();
  for (const p of selleres) conhecidos.add(p.normalized_name);
  for (const a of aliases) conhecidos.add(a.normalized_alias);

  const semDono = new Map<string, string>();
  for (const s of snapshots) {
    const texto = s.source_seller_text?.trim();
    if (!texto) continue;
    const chave = normalizarNome(texto);
    if (!conhecidos.has(chave) && !semDono.has(chave)) semDono.set(chave, texto);
  }

  return [...semDono.values()].sort((a, b) => a.localeCompare(b, "pt-BR"));
}
