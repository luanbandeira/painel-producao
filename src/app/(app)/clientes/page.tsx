import Link from "next/link";
import { exigirPerfil } from "@/lib/auth";
import { criarClienteServidor } from "@/lib/supabase/server";
import { TituloPagina } from "@/components/EstadoVazio";
import {
  carregarProducaoPorCliente,
  hojeISO,
  inicioDoMesDe,
  ultimoDiaComDados,
} from "@/lib/dashboard";
import { carregarInatividade } from "@/lib/inatividade";
import { TabelaClientes } from "./TabelaClientes";
import {
  COLUNAS_VALIDAS,
  type Coluna,
  type Direcao,
  type Linha,
  type Selecao,
} from "./colunas";

/**
 * Lista de clientes.
 *
 * O servidor monta as linhas — a produção do período e os dias sem comprar não
 * existem como coluna no banco — e entrega tudo de uma vez. Busca, filtros e
 * ordenação ficam no navegador (ver TabelaClientes), para responderem no
 * clique. O RLS já limitou a consulta à carteira do vendedor. Se a base
 * passar de mil clientes, esta estratégia precisa ser revista.
 */

export default async function PaginaClientes({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const perfil = await exigirPerfil();
  const params = await searchParams;
  const supabase = await criarClienteServidor();

  /** Um filtro pode vir repetido na URL: normaliza sempre para lista. */
  const lista = (v: string | string[] | undefined): string[] =>
    v === undefined ? [] : Array.isArray(v) ? v : [v];
  const primeiro = (v: string | string[] | undefined): string =>
    (Array.isArray(v) ? v[0] : v) ?? "";

  const [{ data: clientesRes }, fimPeriodo] = await Promise.all([
    supabase
      .from("clients")
      .select("*")
      .order("display_name")
      .limit(1000),
    ultimoDiaComDados(),
  ]);
  const clientes = clientesRes ?? [];
  const ids = clientes.map((c) => c.id);

  const fim = fimPeriodo ?? hojeISO();
  const inicioPeriodo = inicioDoMesDe(fim);

  const [inatividade, resumo, atribuicoesRes] = await Promise.all([
    carregarInatividade(ids),
    carregarProducaoPorCliente(inicioPeriodo, fim),
    supabase
      .from("client_assignments")
      .select("client_id, seller:sellers(name)")
      .eq("status", "ACTIVE")
      .is("valid_until", null),
  ]);

  const responsaveis = new Map<string, string>();
  for (const a of atribuicoesRes.data ?? []) {
    const nome = (a.seller as unknown as { name: string } | null)?.name;
    if (nome) responsaveis.set(a.client_id as string, nome);
  }

  const { porCliente: producao, ultimoDiaProduzido } = resumo;

  const linhas: Linha[] = clientes.map((c) => {
    const inat = inatividade.get(c.id);
    const prod = producao.get(c.id);
    return {
      id: c.id,
      codigo: c.client_code,
      nome: c.display_name,
      documento: c.document,
      dias: inat?.dias ?? null,
      ultimaCompra: inat?.ultimaCompra ?? null,
      referencia: inat?.referencia ?? "",
      plano: c.plan,
      vendedor: responsaveis.get(c.id) ?? null,
      volume: prod?.volume ?? 0,
      ultimoDia: prod?.ultimoDia ?? 0,
      uf: c.uf,
      // Inativo pela planilha e inativado à mão contam a mesma história para
      // quem usa; a tela de detalhe é que distingue a origem
      situacao: c.active === false || c.situation === "Inativo" ? "Inativo" : c.situation,
      ultimaAparicao: c.last_seen_at,
    };
  });

  // Opções dos filtros, derivadas do que existe na base visível
  const distintos = (valores: (string | null)[]) =>
    [...new Set(valores.filter(Boolean) as string[])].sort((a, b) =>
      a.localeCompare(b, "pt-BR")
    );
  const opcoes = {
    planos: distintos(linhas.map((l) => l.plano)),
    vendedores: distintos(linhas.map((l) => l.vendedor)),
    ufs: distintos(linhas.map((l) => l.uf)),
    situacoes: distintos(linhas.map((l) => l.situacao)),
  };

  // Estado inicial: o que veio na URL (link compartilhado, recarga da página)
  /**
   * Sem escolha na URL, a tela abre só com os clientes ativos: os inativos
   * (plano cancelado) não voltam a produzir e só atrapalhariam a
   * leitura. "todos" é a forma explícita de pedir a base inteira.
   */
  const sitPedida = lista(params.sit);
  const sit =
    sitPedida.length === 0
      ? ["Ativo"]
      : sitPedida.includes("todos")
        ? []
        : sitPedida;

  const selecao: Selecao = {
    dias: lista(params.dias),
    equip: lista(params.equip),
    prosp: lista(params.prosp),
    prod: lista(params.prod),
    uf: lista(params.uf),
    sit,
  };
  const ordem: Coluna = COLUNAS_VALIDAS.includes(primeiro(params.ordem) as Coluna)
    ? (primeiro(params.ordem) as Coluna)
    : "nome";
  const dir: Direcao = primeiro(params.dir) === "desc" ? "desc" : "asc";

  return (
    <div>
      <TituloPagina
        titulo="Clientes"
        acao={
          perfil.role !== "SELLER" ? (
            <Link
              href="/clientes/sem-vendedor"
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              Fila sem vendedor
            </Link>
          ) : undefined
        }
      />

      <TabelaClientes
        linhas={linhas}
        opcoes={opcoes}
        inicial={{ termo: primeiro(params.q).trim(), ordem, dir, selecao }}
        inicioPeriodo={inicioPeriodo}
        fim={fim}
        ultimoDiaProduzido={ultimoDiaProduzido}
      />
    </div>
  );
}
