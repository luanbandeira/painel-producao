/** Rótulos em português dos tipos de pendência. */
export const ROTULO_TIPO: Record<string, string> = {
  NO_BASE: "Cliente sem base",
  UNKNOWN_SELLER: "Vendedor desconhecido",
  SELLER_CHANGE: "Alteração de responsável",
  INVALID_DOCUMENT: "Documento inválido",
  DUPLICATE_CODE: "Código duplicado",
  DUPLICATE_DOCUMENT: "Documento em mais de um código",
  NEGATIVE_VOLUME: "Volume negativo",
  NEGATIVE_ORDERS: "Pedidos negativas",
  INCOMPATIBLE_DATE: "Data incompatível",
  INVALID_ROW: "Linha inválida",
  CLIENT_MISSING: "Cliente ausente",
  MISSING_INTERVAL: "Intervalo sem upload",
  AGGREGATED_TRANSFER: "Troca em intervalo agregado",
};

export const ROTULO_SEVERIDADE: Record<string, string> = {
  BLOCKING: "Bloqueante",
  WARNING: "Aviso",
  INFO: "Informativa",
};

export const CLASSE_SEVERIDADE: Record<string, string> = {
  BLOCKING: "rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800",
  WARNING: "rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800",
  INFO: "rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600",
};
