import { LIMITE_ATENCAO, LIMITE_CRITICO } from "@/lib/constantes";

/**
 * Formato compartilhado entre a página (servidor) e a tabela (cliente).
 *
 * Mora num módulo neutro, sem `"use client"`, pelo mesmo motivo de
 * `src/lib/constantes.ts`: quando um Server Component importa um valor de um
 * módulo de cliente, o Next entrega uma *referência* no lugar do valor, e
 * usá-la no servidor derruba a página em tempo de execução. Tipo some na
 * compilação e não daria problema; constante, sim — foi assim que a lista de
 * colunas quebrou a tela de clientes.
 */

export type Coluna =
  | "codigo"
  | "nome"
  | "dias"
  | "plano"
  | "vendedor"
  | "volume"
  | "ultimoDia"
  | "uf"
  | "situacao"
  | "ultimaAparicao";

export type Direcao = "asc" | "desc";

export const COLUNAS_VALIDAS: Coluna[] = [
  "codigo",
  "nome",
  "dias",
  "plano",
  "vendedor",
  "volume",
  "ultimoDia",
  "uf",
  "situacao",
  "ultimaAparicao",
];

/** Filtros da tela; cada um aceita vários valores ao mesmo tempo. */
export const CAMPOS = ["dias", "equip", "prosp", "prod", "uf", "sit"] as const;
export type Campo = (typeof CAMPOS)[number];
export type Selecao = Record<Campo, string[]>;

export const SEM_RESPONSAVEL = "__sem__";
/** Linha sem valor na coluna cai neste balde, para poder ser filtrada. */
export const SEM_VALOR = "__vazio__";

export interface Linha {
  id: string;
  codigo: string;
  nome: string;
  documento: string | null;
  dias: number | null;
  ultimaCompra: string | null;
  referencia: string;
  plano: string | null;
  vendedor: string | null;
  volume: number;
  ultimoDia: number;
  uf: string | null;
  situacao: string | null;
  ultimaAparicao: string | null;
}

export interface OpcoesFiltro {
  planos: string[];
  vendedores: string[];
  ufs: string[];
  situacoes: string[];
}

/** Valor de uma linha em cada filtro — usado para testar e para contar. */
export function valorDaLinha(l: Linha, campo: Campo): string {
  switch (campo) {
    case "equip":
      return l.plano ?? SEM_VALOR;
    case "uf":
      return l.uf ?? SEM_VALOR;
    case "sit":
      return l.situacao ?? SEM_VALOR;
    case "prosp":
      return l.vendedor ?? SEM_RESPONSAVEL;
    case "prod":
      return l.volume > 0 ? "com" : "sem";
    case "dias":
      if (l.dias === null) return SEM_VALOR;
      if (l.dias >= LIMITE_CRITICO) return "critico";
      return l.dias >= LIMITE_ATENCAO ? "atencao" : "ok";
  }
}

/** Filtro vazio não filtra; com valores, basta a linha casar com um deles. */
export function atende(l: Linha, campo: Campo, valores: string[]): boolean {
  return valores.length === 0 || valores.includes(valorDaLinha(l, campo));
}
