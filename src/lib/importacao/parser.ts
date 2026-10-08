import * as XLSX from "xlsx";

/**
 * Parser da planilha diária.
 * As colunas são identificadas pelo NOME NORMALIZADO, nunca pela posição.
 */

// Colunas canônicas
const OBRIGATORIAS = [
  "CLIENTE",
  "CNPJ_CPF",
  "VENDEDOR",
  "PEDIDOS",
  "VOLUME",
  "ULTIMA_COMPRA",
] as const;

const RECOMENDADAS = [
  "UNIDADE",
  "UF",
  "SITUACAO",
  "PLANO",
  "CANAL",
  "DIAS_SEM_COMPRAR",
  "RECENCIA",
] as const;

const IGNORAVEIS = ["CODIGO"] as const;

// Aliases de cabeçalho — chave: forma normalizada encontrada
const ALIASES_CABECALHO: Record<string, string> = {
  ULTIMACOMPRA: "ULTIMA_COMPRA",
  CANAL: "CANAL",
  DIASSEMCOMPRAR: "DIAS_SEM_COMPRAR",
  CNPJCPF: "CNPJ_CPF",
};

export interface Problema {
  tipo:
    | "INVALID_DOCUMENT"
    | "DUPLICATE_CODE"
    | "NEGATIVE_VOLUME"
    | "NEGATIVE_ORDERS"
    | "INCOMPATIBLE_DATE"
    | "INVALID_ROW";
  severidade: "INFO" | "WARNING" | "BLOCKING";
  mensagem: string;
}

export interface LinhaNormalizada {
  client_code: string | null;
  display_name: string | null;
  document: string | null;
  unit: string | null;
  uf: string | null;
  situation: string | null;
  plan: string | null;
  channel: string | null;
  cumulative_volume: number | null;
  cumulative_orders: number | null;
  last_purchase_date: string | null; // ISO yyyy-mm-dd
  days_without_purchase: number | null;
  recency: string | null;
  seller_text: string | null; // null quando vazio/0
  problemas: Problema[];
}

export interface LinhaImportacao {
  numero: number; // linha no Excel (1 = cabeçalho)
  bruto: Record<string, unknown>;
  normalizado: LinhaNormalizada;
  status: "VALID" | "WARNING" | "ERROR";
}

export interface ResultadoParse {
  ok: boolean;
  colunasFaltantes: string[];
  colunasReconhecidas: string[];
  colunasDesconhecidas: string[];
  linhas: LinhaImportacao[];
}

/** Normaliza um cabeçalho: sem acentos, maiúsculas, separador _. */
export function normalizarCabecalho(nome: string): string {
  const bruto = nome
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase()
    .trim()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return ALIASES_CABECALHO[bruto] ?? bruto;
}

/** Extrai código e nome de "0001234-Padaria Exemplo". */
export function extrairCodigoENome(cliente: string): {
  codigo: string | null;
  nome: string | null;
} {
  const texto = cliente.trim();
  const m = texto.match(/^(\d+)\s*-?\s*(.*)$/);
  if (!m || !m[1]) return { codigo: null, nome: texto || null };
  return { codigo: m[1], nome: m[2].trim() || m[1] };
}

/**
 * Documento sem máscara, apenas dígitos, como texto.
 * Restaura zeros à esquerda perdidos quando o Excel trata o documento como
 * número: 12–13 dígitos só podem ser CNPJ (14) e 9–10 só podem ser CPF (11).
 */
export function normalizarDocumento(valor: unknown): string | null {
  if (valor === null || valor === undefined) return null;
  const digitos = String(valor).replace(/\D/g, "");
  if (!digitos) return null;
  if (digitos.length === 12 || digitos.length === 13) {
    return digitos.padStart(14, "0");
  }
  if (digitos.length === 9 || digitos.length === 10) {
    return digitos.padStart(11, "0");
  }
  return digitos;
}

/** vazio, nulo, espaços, "0" ou 0 significam vendedor não informado. */
export function normalizarVendedor(valor: unknown): string | null {
  if (valor === null || valor === undefined) return null;
  const texto = String(valor).trim();
  if (texto === "" || texto === "0") return null;
  return texto;
}

function paraNumero(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === "") return null;
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;
  let texto = String(valor).replace(/R\$\s?/g, "").trim();
  if (texto.includes(",")) {
    texto = texto.replace(/\./g, "").replace(",", ".");
  }
  const n = Number(texto);
  return Number.isFinite(n) ? n : null;
}

function paraInteiro(valor: unknown): number | null {
  const n = paraNumero(valor);
  if (n === null) return null;
  return Number.isInteger(n) ? n : Math.trunc(n);
}

function paraDataISO(valor: unknown): string | null {
  if (valor === null || valor === undefined || valor === "") return null;
  if (valor instanceof Date && !isNaN(valor.getTime())) {
    // xlsx com cellDates entrega Date em UTC-adjacente; usar componentes UTC
    const y = valor.getUTCFullYear();
    const m = String(valor.getUTCMonth() + 1).padStart(2, "0");
    const d = String(valor.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  if (typeof valor === "number") {
    // Serial do Excel (dias desde 30/12/1899)
    const ms = Math.round((valor - 25569) * 86400 * 1000);
    return new Date(ms).toISOString().slice(0, 10);
  }
  const texto = String(valor).trim();
  const br = texto.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const iso = texto.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return null;
}

/**
 * Lê e valida a planilha. `coberturaFim` (yyyy-mm-dd) é usada para checar
 * datas incompatíveis (última compra posterior à cobertura).
 */
export function parsePlanilha(
  conteudo: ArrayBuffer | Buffer,
  coberturaFim?: string
): ResultadoParse {
  const wb = XLSX.read(conteudo, { cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];

  const matriz = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    defval: null,
  });
  const cabecalhosOriginais = (matriz[0] ?? []).map((c) => String(c ?? ""));

  // Mapeia índice da coluna -> nome canônico
  const mapa = new Map<number, string>();
  const reconhecidas: string[] = [];
  const desconhecidas: string[] = [];
  const conhecidas = new Set<string>([
    ...OBRIGATORIAS,
    ...RECOMENDADAS,
    ...IGNORAVEIS,
  ]);

  cabecalhosOriginais.forEach((original, i) => {
    if (!original) return;
    const canonico = normalizarCabecalho(original);
    if (conhecidas.has(canonico)) {
      mapa.set(i, canonico);
      reconhecidas.push(canonico);
    } else {
      desconhecidas.push(original);
    }
  });

  const colunasFaltantes = OBRIGATORIAS.filter(
    (c) => !reconhecidas.includes(c)
  );
  if (colunasFaltantes.length > 0) {
    return {
      ok: false,
      colunasFaltantes: [...colunasFaltantes],
      colunasReconhecidas: reconhecidas,
      colunasDesconhecidas: desconhecidas,
      linhas: [],
    };
  }

  const linhas: LinhaImportacao[] = [];
  const codigosVistos = new Set<string>();

  for (let i = 1; i < matriz.length; i++) {
    const celulas = matriz[i];
    if (!celulas || celulas.every((c) => c === null || c === "")) continue;

    const bruto: Record<string, unknown> = {};
    mapa.forEach((canonico, idx) => {
      bruto[canonico] = celulas[idx] ?? null;
    });

    const problemas: Problema[] = [];
    const cliente = String(bruto["CLIENTE"] ?? "").trim();
    const { codigo, nome } = extrairCodigoENome(cliente);
    const documento = normalizarDocumento(bruto["CNPJ_CPF"]);
    const volume = paraNumero(bruto["VOLUME"]);
    const pedidos = paraInteiro(bruto["PEDIDOS"]);
    const ultimaCompra = paraDataISO(bruto["ULTIMA_COMPRA"]);
    const uf = String(bruto["UF"] ?? "").trim().toUpperCase() || null;

    if (!codigo) {
      problemas.push({
        tipo: "INVALID_ROW",
        severidade: "BLOCKING",
        mensagem: `Código do cliente não pôde ser extraído de "${cliente}".`,
      });
    } else if (codigosVistos.has(codigo)) {
      problemas.push({
        tipo: "DUPLICATE_CODE",
        severidade: "BLOCKING",
        mensagem: `Código ${codigo} aparece mais de uma vez no arquivo.`,
      });
    } else {
      codigosVistos.add(codigo);
    }

    if (volume === null) {
      problemas.push({
        tipo: "INVALID_ROW",
        severidade: "BLOCKING",
        mensagem: "Volume ausente ou não numérico.",
      });
    } else if (volume < 0) {
      problemas.push({
        tipo: "NEGATIVE_VOLUME",
        severidade: "BLOCKING",
        mensagem: `Volume acumulado negativo (${volume}).`,
      });
    }

    if (pedidos === null) {
      problemas.push({
        tipo: "INVALID_ROW",
        severidade: "BLOCKING",
        mensagem: "Pedidos ausentes ou não numéricas.",
      });
    } else if (pedidos < 0) {
      problemas.push({
        tipo: "NEGATIVE_ORDERS",
        severidade: "BLOCKING",
        mensagem: `Pedidos acumulados negativas (${pedidos}).`,
      });
    }

    if (documento && documento.length !== 11 && documento.length !== 14) {
      problemas.push({
        tipo: "INVALID_DOCUMENT",
        severidade: "WARNING",
        mensagem: `Documento com ${documento.length} dígitos (esperado CPF=11 ou CNPJ=14).`,
      });
    }

    if (coberturaFim && ultimaCompra && ultimaCompra > coberturaFim) {
      problemas.push({
        tipo: "INCOMPATIBLE_DATE",
        severidade: "WARNING",
        mensagem: `Última compra (${ultimaCompra}) posterior à cobertura (${coberturaFim}).`,
      });
    }

    const temBloqueante = problemas.some((p) => p.severidade === "BLOCKING");
    const status: LinhaImportacao["status"] = temBloqueante
      ? "ERROR"
      : problemas.length > 0
        ? "WARNING"
        : "VALID";

    linhas.push({
      numero: i + 1,
      bruto,
      normalizado: {
        client_code: codigo,
        display_name: nome,
        document: documento,
        unit: (String(bruto["UNIDADE"] ?? "").trim() || null) as string | null,
        uf: uf && uf.length === 2 ? uf : null,
        situation: String(bruto["SITUACAO"] ?? "").trim() || null,
        plan: String(bruto["PLANO"] ?? "").trim() || null,
        channel: String(bruto["CANAL"] ?? "").trim() || null,
        cumulative_volume: volume,
        cumulative_orders: pedidos,
        last_purchase_date: ultimaCompra,
        days_without_purchase: paraInteiro(bruto["DIAS_SEM_COMPRAR"]),
        recency: String(bruto["RECENCIA"] ?? "").trim() || null,
        seller_text: normalizarVendedor(bruto["VENDEDOR"]),
        problemas,
      },
      status,
    });
  }

  return {
    ok: true,
    colunasFaltantes: [],
    colunasReconhecidas: reconhecidas,
    colunasDesconhecidas: desconhecidas,
    linhas,
  };
}
