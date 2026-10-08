"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import {
  cancelarUpload,
  excluirUpload,
  restaurarUpload,
  type EstadoUpload,
} from "../actions";
import { FRASE_EXCLUSAO } from "@/lib/constantes";

export interface ImpactoCancelamento {
  diasAfetados: string; // dd/mm/yyyy
  clientesAfetados: number;
  calculosInvalidados: number;
  formaraIntervaloAgregado: boolean;
}

const classeCampo =
  "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

function PainelConfirmacao({
  titulo,
  impacto,
  children,
  onFechar,
}: {
  titulo: string;
  impacto: React.ReactNode;
  children: React.ReactNode;
  onFechar: () => void;
}) {
  return (
    <div className="rounded-lg border-2 border-red-200 bg-red-50 p-4">
      <div className="flex items-start justify-between">
        <h3 className="text-sm font-semibold text-red-900">{titulo}</h3>
        <button type="button" onClick={onFechar} className="text-sm text-slate-500 hover:underline">
          Voltar
        </button>
      </div>
      <div className="mt-2 rounded-md bg-white p-3 text-sm text-slate-700">{impacto}</div>
      <div className="mt-3">{children}</div>
    </div>
  );
}

export function AcoesUpload({
  importId,
  status,
  ehAdmin,
  impacto,
  podeExcluir,
}: {
  importId: string;
  status: string;
  ehAdmin: boolean;
  impacto: ImpactoCancelamento;
  podeExcluir: boolean;
}) {
  const [painel, setPainel] = useState<"" | "cancelar" | "restaurar" | "excluir">("");

  const [estadoCancelar, acaoCancelar, cancelando] = useActionState(
    cancelarUpload.bind(null, importId),
    {} as EstadoUpload
  );
  const [estadoRestaurar, acaoRestaurar, restaurando] = useActionState(
    restaurarUpload.bind(null, importId),
    {} as EstadoUpload
  );
  const [estadoExcluir, acaoExcluir, excluindo] = useActionState(
    excluirUpload.bind(null, importId),
    {} as EstadoUpload
  );

  const ativo = status === "ATIVO" || status === "COM_PENDENCIAS";

  if (painel === "cancelar") {
    return (
      <PainelConfirmacao
        titulo="Cancelar este upload"
        onFechar={() => setPainel("")}
        impacto={
          <ul className="list-inside list-disc space-y-1">
            <li>Dia afetado: <strong>{impacto.diasAfetados}</strong></li>
            <li><strong>{impacto.clientesAfetados}</strong> snapshot(s) de clientes sairão dos cálculos</li>
            <li><strong>{impacto.calculosInvalidados}</strong> cálculo(s) de produção serão invalidados e recalculados</li>
            {impacto.formaraIntervaloAgregado && (
              <li className="text-orange-700">
                Existem uploads posteriores: o período será recalculado como
                <strong> intervalo agregado</strong>
              </li>
            )}
            <li>O arquivo original e os metadados são preservados; a restauração é possível</li>
          </ul>
        }
      >
        <form action={acaoCancelar} className="space-y-3">
          <div>
            <label htmlFor="motivo-cancelar" className="block text-sm font-medium text-slate-700">
              Motivo do cancelamento *
            </label>
            <textarea id="motivo-cancelar" name="motivo" rows={2} required className={classeCampo} />
          </div>
          {estadoCancelar.erro && (
            <p role="alert" className="text-sm text-red-700">{estadoCancelar.erro}</p>
          )}
          <button
            type="submit"
            disabled={cancelando}
            className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
          >
            {cancelando ? "Cancelando..." : "Cancelar upload e recalcular"}
          </button>
        </form>
      </PainelConfirmacao>
    );
  }

  if (painel === "restaurar") {
    return (
      <PainelConfirmacao
        titulo="Restaurar este upload"
        onFechar={() => setPainel("")}
        impacto={
          <p>
            O upload voltará a ficar ativo e toda a produção do período será
            recalculada. A restauração só é possível se não houver outra versão
            ativa para a mesma data.
          </p>
        }
      >
        <form action={acaoRestaurar} className="space-y-3">
          <div>
            <label htmlFor="motivo-restaurar" className="block text-sm font-medium text-slate-700">
              Motivo da restauração *
            </label>
            <textarea id="motivo-restaurar" name="motivo" rows={2} required className={classeCampo} />
          </div>
          {estadoRestaurar.erro && (
            <p role="alert" className="text-sm text-red-700">{estadoRestaurar.erro}</p>
          )}
          <button
            type="submit"
            disabled={restaurando}
            className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-60"
          >
            {restaurando ? "Restaurando..." : "Restaurar upload e recalcular"}
          </button>
        </form>
      </PainelConfirmacao>
    );
  }

  if (painel === "excluir") {
    return (
      <PainelConfirmacao
        titulo="Excluir definitivamente"
        onFechar={() => setPainel("")}
        impacto={
          <p>
            Ação <strong>irreversível</strong>: o arquivo e as linhas lidas serão
            removidos. Permitida apenas porque este upload nunca gerou
            snapshots. O registro de auditoria é preservado.
          </p>
        }
      >
        <form action={acaoExcluir} className="space-y-3">
          <div>
            <label htmlFor="motivo-excluir" className="block text-sm font-medium text-slate-700">
              Motivo da exclusão *
            </label>
            <textarea id="motivo-excluir" name="motivo" rows={2} required className={classeCampo} />
          </div>
          <div>
            <label htmlFor="frase" className="block text-sm font-medium text-slate-700">
              Digite <span className="font-mono text-red-700">{FRASE_EXCLUSAO}</span> para confirmar *
            </label>
            <input id="frase" name="frase" required className={classeCampo} autoComplete="off" />
          </div>
          {estadoExcluir.erro && (
            <p role="alert" className="text-sm text-red-700">{estadoExcluir.erro}</p>
          )}
          <button
            type="submit"
            disabled={excluindo}
            className="rounded-md bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-60"
          >
            {excluindo ? "Excluindo..." : "Excluir definitivamente"}
          </button>
        </form>
      </PainelConfirmacao>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      {ativo && (
        <Link
          href={`/uploads/${importId}/substituir`}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
        >
          Substituir por nova versão
        </Link>
      )}
      {ativo && ehAdmin && (
        <button
          type="button"
          onClick={() => setPainel("cancelar")}
          className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
        >
          Cancelar upload
        </button>
      )}
      {status === "CANCELADO" && ehAdmin && (
        <button
          type="button"
          onClick={() => setPainel("restaurar")}
          className="rounded-md border border-green-300 px-4 py-2 text-sm font-medium text-green-700 hover:bg-green-50"
        >
          Restaurar upload
        </button>
      )}
      {podeExcluir && ehAdmin && (
        <button
          type="button"
          onClick={() => setPainel("excluir")}
          className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
        >
          Excluir definitivamente
        </button>
      )}
    </div>
  );
}
