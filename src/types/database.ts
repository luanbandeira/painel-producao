export type Papel = "ADMIN" | "MANAGER" | "SELLER";

export const ROTULO_PAPEL: Record<Papel, string> = {
  ADMIN: "Administrador",
  MANAGER: "Gestor",
  SELLER: "Vendedor",
};

export interface Perfil {
  id: string;
  name: string;
  email: string;
  role: Papel;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export type StatusImport =
  | "RECEBIDO"
  | "VALIDANDO"
  | "PREVIA"
  | "PROCESSANDO"
  | "ATIVO"
  | "COM_PENDENCIAS"
  | "SUBSTITUIDO"
  | "CANCELADO"
  | "ERRO"
  | "EXCLUIDO";

export const ROTULO_STATUS_IMPORT: Record<StatusImport, string> = {
  RECEBIDO: "Recebido",
  VALIDANDO: "Validando",
  PREVIA: "Prévia",
  PROCESSANDO: "Processando",
  ATIVO: "Ativo",
  COM_PENDENCIAS: "Com pendências",
  SUBSTITUIDO: "Substituído",
  CANCELADO: "Cancelado",
  ERRO: "Erro",
  EXCLUIDO: "Excluído",
};

export interface Importacao {
  id: string;
  report_date: string;
  coverage_end_date: string;
  file_name: string;
  file_storage_key: string;
  checksum_sha256: string;
  version: number;
  status: StatusImport;
  total_rows: number | null;
  valid_rows: number | null;
  new_clients: number | null;
  issue_count: number | null;
  uploaded_by: string;
  uploaded_at: string;
  confirmed_at: string | null;
  error_message: string | null;
  cancellation_reason: string | null;
  replaced_import_id: string | null;
}

export interface Cliente {
  id: string;
  client_code: string;
  document: string | null;
  display_name: string;
  unit: string | null;
  uf: string | null;
  situation: string | null;
  plan: string | null;
  channel: string | null;
  active: boolean;
  first_seen_at: string | null;
  last_seen_at: string | null;
}

export interface Vendedor {
  id: string;
  user_id: string | null;
  name: string;
  normalized_name: string;
  email: string | null;
  phone: string | null;
  active: boolean;
  entry_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}
