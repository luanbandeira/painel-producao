"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatarBRL, formatarData } from "@/lib/formato";
import { LIMITE_ATENCAO, LIMITE_CRITICO } from "@/lib/constantes";
import { ContadorInatividade } from "@/components/ContadorInatividade";
import {
  atende,
  CAMPOS,
  SEM_RESPONSAVEL,
  valorDaLinha,
  type Campo,
  type Coluna,
  type Direcao,
  type Linha,
  type OpcoesFiltro,
  type Selecao,
} from "./colunas";

interface Opcao {
  valor: string;
  rotulo: string;
}

interface Filtro {
  campo: string;
  rotulo: string;
  opcoes: Opcao[];
}

const FAIXAS_DIAS: Opcao[] = [
  { valor: "ok", rotulo: `Até ${LIMITE_ATENCAO - 1} dias` },
  { valor: "atencao", rotulo: `${LIMITE_ATENCAO} a ${LIMITE_CRITICO - 1} dias` },
  { valor: "critico", rotulo: `${LIMITE_CRITICO} dias ou mais` },
];

/** Atalhos de situação: a tela abre nos ativos (ver comentário em page.tsx). */
const INATIVO = "Inativo";
const VISOES = [
  {
    rotulo: "Ativos",
    valores: ["Ativo"],
    contar: (ls: Linha[]) => ls.filter((l) => l.situacao !== INATIVO).length,
  },
  {
    rotulo: "Inativos",
    valores: [INATIVO],
    contar: (ls: Linha[]) => ls.filter((l) => l.situacao === INATIVO).length,
  },
  {
    rotulo: "Todos",
    valores: [] as string[],
    contar: (ls: Linha[]) => ls.length,
  },
];

const PRODUCAO: Opcao[] = [
  { valor: "com", rotulo: "Com produção" },
  { valor: "sem", rotulo: "Sem produção" },
];

/** Caixa de seleção desenhada — some do fluxo mas continua acessível. */
function Caixa({ marcada }: { marcada: boolean }) {
  return (
    <span
      aria-hidden
      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] font-bold ${
        marcada
          ? "border-blue-600 bg-blue-600 text-white"
          : "border-slate-300 bg-white text-transparent"
      }`}
    >
      ✓
    </span>
  );
}

/** Menu de seleção múltipla, com contagem de clientes por opção. */
function FiltroMultiplo({
  rotulo,
  opcoes,
  selecionados,
  contagem,
  aoMudar,
}: {
  rotulo: string;
  opcoes: Opcao[];
  selecionados: string[];
  contagem: Map<string, number>;
  aoMudar: (valores: string[]) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const caixa = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    function clique(e: MouseEvent) {
      if (caixa.current && !caixa.current.contains(e.target as Node)) {
        setAberto(false);
      }
    }
    function tecla(e: KeyboardEvent) {
      if (e.key === "Escape") setAberto(false);
    }
    document.addEventListener("mousedown", clique);
    document.addEventListener("keydown", tecla);
    return () => {
      document.removeEventListener("mousedown", clique);
      document.removeEventListener("keydown", tecla);
    };
  }, [aberto]);

  const visiveis = busca
    ? opcoes.filter((o) => o.rotulo.toLowerCase().includes(busca.toLowerCase()))
    : opcoes;

  const resumo =
    selecionados.length === 0
      ? "Todos"
      : selecionados.length === 1
        ? (opcoes.find((o) => o.valor === selecionados[0])?.rotulo ??
          selecionados[0])
        : `${selecionados.length} selecionados`;

  return (
    <div ref={caixa} className="relative">
      <span className="block text-sm font-bold text-slate-800">{rotulo}</span>
      <button
        type="button"
        onClick={() => setAberto((a) => !a)}
        aria-expanded={aberto}
        className={`mt-1 flex w-full items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-left text-sm ${
          selecionados.length > 0
            ? "border-blue-500 bg-blue-50 font-medium text-blue-900"
            : "border-slate-300 bg-white text-slate-700 hover:border-slate-400"
        }`}
      >
        <span className="truncate">{resumo}</span>
        <span aria-hidden className="shrink-0 text-slate-400">
          ▾
        </span>
      </button>

      {aberto && (
        <div className="absolute z-20 mt-1 w-full min-w-56 max-w-xs rounded-md border border-slate-200 bg-white shadow-lg">
          {opcoes.length > 8 && (
            <div className="border-b border-slate-100 p-2">
              <input
                autoFocus
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Filtrar opções"
                className="w-full rounded border border-slate-300 px-2 py-1 text-xs focus:border-blue-500 focus:outline-none"
              />
            </div>
          )}

          <div className="max-h-60 overflow-y-auto p-1">
            {visiveis.length === 0 ? (
              <p className="px-2 py-2 text-xs text-slate-500">Nenhuma opção</p>
            ) : (
              visiveis.map((o) => {
                const marcada = selecionados.includes(o.valor);
                return (
                  <label
                    key={o.valor}
                    className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm ${
                      marcada
                        ? "bg-blue-50 text-blue-900"
                        : "text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={marcada}
                      onChange={() =>
                        aoMudar(
                          marcada
                            ? selecionados.filter((v) => v !== o.valor)
                            : [...selecionados, o.valor]
                        )
                      }
                    />
                    <Caixa marcada={marcada} />
                    <span className="flex-1 truncate">{o.rotulo}</span>
                    <span className="text-xs tabular-nums text-slate-400">
                      {contagem.get(o.valor) ?? 0}
                    </span>
                  </label>
                );
              })
            )}
          </div>

          <div className="flex items-center justify-between border-t border-slate-100 px-2 py-1.5">
            <button
              type="button"
              onClick={() => aoMudar(visiveis.map((o) => o.valor))}
              className="text-xs text-blue-600 hover:underline"
            >
              Marcar todos
            </button>
            <button
              type="button"
              onClick={() => aoMudar([])}
              disabled={selecionados.length === 0}
              className="text-xs text-slate-500 hover:underline disabled:opacity-40"
            >
              Limpar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Cabeçalho que ordena ao ser clicado, alternando a direção. */
function Ordenavel({
  coluna,
  ordem,
  dir,
  aoOrdenar,
  children,
  className = "",
}: {
  coluna: Coluna;
  ordem: Coluna;
  dir: Direcao;
  aoOrdenar: (c: Coluna) => void;
  children: React.ReactNode;
  className?: string;
}) {
  const ativo = ordem === coluna;
  return (
    <th
      className={className}
      aria-sort={ativo ? (dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => aoOrdenar(coluna)}
        className={`inline-flex items-center gap-1 hover:text-slate-900 ${
          ativo ? "text-slate-900" : ""
        }`}
      >
        {children}
        <span aria-hidden className={ativo ? "" : "text-slate-300"}>
          {ativo ? (dir === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </button>
    </th>
  );
}

/**
 * Lista de clientes: busca, filtros e ordenação acontecem no navegador.
 *
 * O servidor entrega as linhas prontas uma única vez; daí em diante marcar um
 * filtro é só recalcular um array em memória. Fazer isso pela URL custava uma
 * navegação e uma nova rodada de consultas a cada clique — a caixa só ficava
 * marcada quando a resposta chegava. A URL continua sendo atualizada (para
 * poder recarregar ou compartilhar), mas por history.replaceState, sem
 * recarregar a página.
 */

export function TabelaClientes({
  linhas,
  opcoes,
  inicial,
  inicioPeriodo,
  fim,
  ultimoDiaProduzido,
}: {
  linhas: Linha[];
  opcoes: OpcoesFiltro;
  inicial: { termo: string; ordem: Coluna; dir: Direcao; selecao: Selecao };
  inicioPeriodo: string;
  fim: string;
  ultimoDiaProduzido: string | null;
}) {
  const [termo, setTermo] = useState(inicial.termo);
  const [selecao, setSelecao] = useState<Selecao>(inicial.selecao);
  const [ordem, setOrdem] = useState<Coluna>(inicial.ordem);
  const [dir, setDir] = useState<Direcao>(inicial.dir);

  const comoOpcoes = (valores: string[]): Opcao[] =>
    valores.map((v) => ({ valor: v, rotulo: v }));

  const filtros: Filtro[] = useMemo(
    () => [
      { campo: "dias", rotulo: "Dias s/ comprar", opcoes: FAIXAS_DIAS },
      {
        campo: "equip",
        rotulo: "Plano",
        opcoes: comoOpcoes(opcoes.planos),
      },
      {
        campo: "prosp",
        rotulo: "Vendedor",
        opcoes: [
          { valor: SEM_RESPONSAVEL, rotulo: "Sem responsável" },
          ...comoOpcoes(opcoes.vendedores),
        ],
      },
      { campo: "prod", rotulo: "Produção no período", opcoes: PRODUCAO },
      { campo: "uf", rotulo: "UF", opcoes: comoOpcoes(opcoes.ufs) },
      { campo: "sit", rotulo: "Situação", opcoes: comoOpcoes(opcoes.situacoes) },
    ],
    [opcoes]
  );

  // Busca aplicada isoladamente: serve de base tanto para os filtros quanto
  // para as contagens de cada opção
  const porBusca = useMemo(() => {
    const t = termo.trim().toLowerCase();
    if (!t) return linhas;
    const digitos = t.replace(/\D/g, "");
    return linhas.filter(
      (l) =>
        l.nome.toLowerCase().includes(t) ||
        l.codigo.toLowerCase().includes(t) ||
        (digitos !== "" && (l.documento ?? "").includes(digitos))
    );
  }, [linhas, termo]);

  const filtradas = useMemo(() => {
    const resultado = porBusca.filter((l) =>
      CAMPOS.every((c) => atende(l, c, selecao[c]))
    );
    const texto = (v: string | null) => v ?? "";
    return [...resultado].sort((a, b) => {
      let r = 0;
      switch (ordem) {
        case "codigo":
          r = a.codigo.localeCompare(b.codigo, "pt-BR", { numeric: true });
          break;
        case "dias":
          // Sem informação vai sempre para o fim, em qualquer direção
          if (a.dias === null || b.dias === null) {
            return a.dias === b.dias ? 0 : a.dias === null ? 1 : -1;
          }
          r = a.dias - b.dias;
          break;
        case "plano":
          r = texto(a.plano).localeCompare(texto(b.plano), "pt-BR");
          break;
        case "vendedor":
          r = texto(a.vendedor).localeCompare(texto(b.vendedor), "pt-BR");
          break;
        case "volume":
          r = a.volume - b.volume;
          break;
        case "ultimoDia":
          r = a.ultimoDia - b.ultimoDia;
          break;
        case "uf":
          r = texto(a.uf).localeCompare(texto(b.uf), "pt-BR");
          break;
        case "situacao":
          r = texto(a.situacao).localeCompare(texto(b.situacao), "pt-BR");
          break;
        case "ultimaAparicao":
          r = texto(a.ultimaAparicao).localeCompare(texto(b.ultimaAparicao));
          break;
        default:
          r = a.nome.localeCompare(b.nome, "pt-BR");
      }
      return dir === "asc" ? r : -r;
    });
  }, [porBusca, selecao, ordem, dir]);

  /**
   * Quantos clientes cada opção traria — considerando os OUTROS filtros já
   * marcados, como num filtro de planilha. É o que deixa claro o efeito de
   * marcar mais uma caixa antes de clicar.
   */
  const contagens = useMemo(() => {
    const mapa = new Map<string, Map<string, number>>();
    for (const campo of CAMPOS) {
      const base = porBusca.filter((l) =>
        CAMPOS.every((c) => c === campo || atende(l, c, selecao[c]))
      );
      const conta = new Map<string, number>();
      for (const l of base) {
        const v = valorDaLinha(l, campo);
        conta.set(v, (conta.get(v) ?? 0) + 1);
      }
      mapa.set(campo, conta);
    }
    return mapa;
  }, [porBusca, selecao]);

  // Espelha o estado na URL sem navegar: dá para recarregar ou compartilhar
  useEffect(() => {
    const q = new URLSearchParams();
    if (termo.trim()) q.set("q", termo.trim());
    for (const campo of CAMPOS) {
      for (const v of selecao[campo]) q.append(campo, v);
    }
    if (ordem !== "nome") q.set("ordem", ordem);
    if (dir !== "asc") q.set("dir", dir);
    const busca = q.toString();
    window.history.replaceState(
      null,
      "",
      busca ? `/clientes?${busca}` : "/clientes"
    );
  }, [termo, selecao, ordem, dir]);

  function ordenar(coluna: Coluna) {
    if (coluna === ordem) {
      setDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setOrdem(coluna);
      setDir("asc");
    }
  }

  const marcados = filtros.flatMap((f) =>
    selecao[f.campo as Campo].map((v) => ({
      campo: f.campo as Campo,
      rotuloCampo: f.rotulo,
      valor: v,
      rotulo: f.opcoes.find((o) => o.valor === v)?.rotulo ?? v,
    }))
  );

  const limparTudo = () =>
    setSelecao({ dias: [], equip: [], prosp: [], prod: [], uf: [], sit: [] });

  // No celular a tabela disputa 343px: metade do respiro lateral evita que
  // ela precise de rolagem horizontal para as quatro colunas visiveis.
  const th = "px-2 py-3 sm:px-4";

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-sm text-slate-600">Exibindo:</span>
        {VISOES.map((v) => {
          const ativo =
            v.valores.length === selecao.sit.length &&
            v.valores.every((x) => selecao.sit.includes(x));
          return (
            <button
              key={v.rotulo}
              type="button"
              onClick={() => setSelecao((sel) => ({ ...sel, sit: v.valores }))}
              className={
                ativo
                  ? "rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white"
                  : "rounded-md border border-slate-300 px-3 py-1 text-xs text-slate-700 hover:bg-slate-100"
              }
            >
              {v.rotulo} ({v.contar(linhas)})
            </button>
          );
        })}
      </div>

      <div className="mb-4 rounded-lg border border-slate-200 bg-white p-3">
        <div className="mb-3 flex max-w-md items-center gap-2">
          <input
            type="search"
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            placeholder="Buscar por nome, código ou CNPJ/CPF"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        {/*
          Três colunas no máximo: com seis, cada uma ficava mais estreita que o
          min-w-56 do menu suspenso, e o menu da última coluna passava da borda
          da página — a tela inteira ganhava rolagem horizontal ao abrir o
          filtro. Duas linhas de três também se leem melhor.
        */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtros.map((f) => (
            <FiltroMultiplo
              key={f.campo}
              rotulo={f.rotulo}
              opcoes={f.opcoes}
              selecionados={selecao[f.campo as Campo]}
              contagem={contagens.get(f.campo) ?? new Map()}
              aoMudar={(valores) =>
                setSelecao((s) => ({ ...s, [f.campo]: valores }))
              }
            />
          ))}
        </div>

        {marcados.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
            <span className="text-xs font-medium text-slate-500">
              Filtrando por:
            </span>
            {marcados.map((m) => (
              <button
                key={`${m.campo}-${m.valor}`}
                type="button"
                onClick={() =>
                  setSelecao((s) => ({
                    ...s,
                    [m.campo]: s[m.campo].filter((v) => v !== m.valor),
                  }))
                }
                title={`Remover filtro ${m.rotuloCampo}: ${m.rotulo}`}
                className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 py-1 pl-2 pr-1.5 text-xs text-blue-900 hover:bg-blue-100"
              >
                <span className="text-blue-600">{m.rotuloCampo}:</span>
                <span className="font-medium">{m.rotulo}</span>
                <span aria-hidden className="text-blue-400">
                  ✕
                </span>
              </button>
            ))}
            <button
              type="button"
              onClick={limparTudo}
              className="text-xs text-slate-500 hover:underline"
            >
              limpar todos
            </button>
          </div>
        )}
      </div>

      <p className="mb-2 text-sm text-slate-600">
        <strong className="text-slate-900">{filtradas.length}</strong> de{" "}
        {linhas.length} cliente(s) · produção de {formatarData(inicioPeriodo)} a{" "}
        {formatarData(fim)}
        {ultimoDiaProduzido
          ? `, último dia ${formatarData(ultimoDiaProduzido)}`
          : ""}
      </p>

      {filtradas.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-10 text-center text-sm text-slate-500">
          Nenhum cliente atende aos filtros selecionados.
          {marcados.length > 0 && (
            <button
              type="button"
              onClick={limparTudo}
              className="ml-1 text-blue-600 hover:underline"
            >
              Limpar filtros
            </button>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <Ordenavel coluna="codigo" ordem={ordem} dir={dir} aoOrdenar={ordenar} className={`hidden ${th} sm:table-cell`}>
                  Código
                </Ordenavel>
                <Ordenavel coluna="nome" ordem={ordem} dir={dir} aoOrdenar={ordenar} className={th}>
                  Cliente
                </Ordenavel>
                <Ordenavel coluna="dias" ordem={ordem} dir={dir} aoOrdenar={ordenar} className={`${th} text-center`}>
                  Dias s/ comprar
                </Ordenavel>
                <Ordenavel coluna="plano" ordem={ordem} dir={dir} aoOrdenar={ordenar} className={`hidden ${th} sm:table-cell`}>
                  Plano
                </Ordenavel>
                <Ordenavel coluna="vendedor" ordem={ordem} dir={dir} aoOrdenar={ordenar} className={`hidden ${th} sm:table-cell`}>
                  Vendedor
                </Ordenavel>
                <Ordenavel coluna="volume" ordem={ordem} dir={dir} aoOrdenar={ordenar} className={`${th} text-right`}>
                  Volume no período
                </Ordenavel>
                <Ordenavel coluna="ultimoDia" ordem={ordem} dir={dir} aoOrdenar={ordenar} className={`hidden ${th} text-right sm:table-cell`}>
                  Último dia
                </Ordenavel>
                <Ordenavel coluna="uf" ordem={ordem} dir={dir} aoOrdenar={ordenar} className={`hidden ${th} lg:table-cell`}>
                  UF
                </Ordenavel>
                <Ordenavel coluna="situacao" ordem={ordem} dir={dir} aoOrdenar={ordenar} className={`hidden ${th} lg:table-cell`}>
                  Situação
                </Ordenavel>
                <Ordenavel coluna="ultimaAparicao" ordem={ordem} dir={dir} aoOrdenar={ordenar} className={`hidden ${th} lg:table-cell`}>
                  Última aparição
                </Ordenavel>
              </tr>
            </thead>
            <tbody>
              {filtradas.map((l) => (
                <tr key={l.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="hidden px-2 py-3 sm:px-4 font-mono text-xs text-slate-700 sm:table-cell">
                    <Link href={`/clientes/${l.id}`} className="text-blue-600 hover:underline">
                      {l.codigo}
                    </Link>
                  </td>
                  {/* w-full + max-w-0: a coluna fica com a sobra da tabela e a
                      razao social corta com reticencias, em vez de esticar a
                      linha para quatro linhas no celular. */}
                  <td className="w-full max-w-0 px-2 py-3 font-medium text-slate-900 sm:px-4">
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/clientes/${l.id}`}
                        className="truncate hover:underline"
                        title={l.nome}
                      >
                        {l.nome}
                      </Link>
                      {l.situacao === INATIVO && (
                        <span className="shrink-0 rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600">
                          Inativo
                        </span>
                      )}
                    </div>
                    {/* No celular a coluna do vendedor nao cabe; ela vem
                        aqui, junto do codigo, e o nome fica com a largura. */}
                    <span className="block text-xs font-normal text-slate-500 sm:hidden">
                      <span className="font-mono">{l.codigo}</span>
                      {" · "}
                      {l.vendedor ?? (
                        <span className="text-orange-600">Sem responsável</span>
                      )}
                    </span>
                  </td>
                  <td className="px-2 py-3 sm:px-4 text-center">
                    <ContadorInatividade
                      dias={l.dias}
                      ultimaCompra={l.ultimaCompra}
                      referencia={l.referencia}
                    />
                  </td>
                  <td className="hidden px-2 py-3 sm:px-4 sm:table-cell">
                    {l.plano ? (
                      <span className="inline-block rounded bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-700">
                        {l.plano}
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="hidden px-2 py-3 text-slate-600 sm:table-cell sm:px-4">
                    {l.vendedor ?? <span className="text-orange-600">Sem responsável</span>}
                  </td>
                  <td className="px-2 py-3 sm:px-4 text-right font-medium text-slate-900 whitespace-nowrap">
                    {formatarBRL(l.volume)}
                  </td>
                  <td className="hidden px-2 py-3 sm:px-4 text-right text-slate-600 whitespace-nowrap sm:table-cell">
                    {formatarBRL(l.ultimoDia)}
                  </td>
                  <td className="hidden px-2 py-3 sm:px-4 text-slate-600 lg:table-cell">{l.uf ?? "—"}</td>
                  <td className="hidden px-2 py-3 sm:px-4 text-slate-600 lg:table-cell">{l.situacao ?? "—"}</td>
                  <td className="hidden px-2 py-3 sm:px-4 text-slate-600 lg:table-cell">
                    {formatarData(l.ultimaAparicao)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
