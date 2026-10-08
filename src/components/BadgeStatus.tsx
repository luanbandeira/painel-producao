import {
  ROTULO_STATUS_IMPORT,
  type StatusImport,
} from "@/types/database";

const COR_STATUS: Record<StatusImport, string> = {
  RECEBIDO: "bg-slate-100 text-slate-700",
  VALIDANDO: "bg-slate-100 text-slate-700",
  PREVIA: "bg-amber-100 text-amber-800",
  PROCESSANDO: "bg-blue-100 text-blue-800",
  ATIVO: "bg-green-100 text-green-800",
  COM_PENDENCIAS: "bg-orange-100 text-orange-800",
  SUBSTITUIDO: "bg-slate-200 text-slate-600",
  CANCELADO: "bg-red-100 text-red-800",
  ERRO: "bg-red-100 text-red-800",
  EXCLUIDO: "bg-slate-200 text-slate-600",
};

export function BadgeStatus({ status }: { status: StatusImport }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${COR_STATUS[status]}`}
    >
      {ROTULO_STATUS_IMPORT[status]}
    </span>
  );
}
