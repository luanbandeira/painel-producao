import Link from "next/link";
import { exigirPerfil } from "@/lib/auth";
import { criarClienteServidor } from "@/lib/supabase/server";
import { EstadoVazio, TituloPagina } from "@/components/EstadoVazio";
import { formatarData } from "@/lib/formato";

const ROTULO_STATUS: Record<string, { texto: string; classe: string }> = {
  RASCUNHO: { texto: "Rascunho", classe: "bg-slate-100 text-slate-700" },
  ATIVA: { texto: "Ativa", classe: "bg-green-100 text-green-800" },
  ENCERRADA: { texto: "Encerrada", classe: "bg-blue-100 text-blue-800" },
  CANCELADA: { texto: "Cancelada", classe: "bg-red-100 text-red-800" },
};

const ROTULO_METRICA: Record<string, string> = {
  Volume: "Volume total",
  ORDERS: "Pedidos",
  CLIENTS: "Clientes produzindo",
};

export default async function PaginaCampanhas() {
  const perfil = await exigirPerfil();
  const supabase = await criarClienteServidor();

  // Vendedor vê campanhas ativas e encerradas — encerrada é quando ele
  // mais quer conferir o próprio resultado. Rascunho e cancelada ficam com a
  // gestão. (O RLS aplica a mesma regra no banco; aqui o filtro é explícito
  // para a intenção ficar clara no código.)
  let consulta = supabase
    .from("campaigns")
    .select("id, name, start_date, end_date, status, primary_metric, target_value")
    .order("start_date", { ascending: false });
  if (perfil.role === "SELLER") {
    consulta = consulta.in("status", ["ATIVA", "ENCERRADA"]);
  }

  const { data } = await consulta;
  const campanhas = data ?? [];

  return (
    <div>
      <TituloPagina
        titulo="Campanhas"
        acao={
          perfil.role !== "SELLER" ? (
            <Link
              href="/campanhas/nova"
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Nova campanha
            </Link>
          ) : undefined
        }
      />

      {campanhas.length === 0 ? (
        <EstadoVazio
          mensagem={
            perfil.role === "SELLER"
              ? "Você ainda não participa de nenhuma campanha."
              : "Nenhuma campanha cadastrada. Crie a primeira campanha para acompanhar a produção do mês."
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3">Nome</th>
                <th className="hidden px-4 py-3 sm:table-cell">Período</th>
                <th className="hidden px-4 py-3 lg:table-cell">Métrica principal</th>
                <th className="px-4 py-3">Status</th>
                <th className="hidden px-4 py-3 sm:table-cell"></th>
              </tr>
            </thead>
            <tbody>
              {campanhas.map((c) => {
                const st = ROTULO_STATUS[c.status] ?? ROTULO_STATUS.RASCUNHO;
                return (
                  <tr key={c.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-3 font-medium text-slate-900">
                      <Link href={`/campanhas/${c.id}`} className="hover:underline">
                        {c.name}
                      </Link>
                      <span className="block text-xs font-normal text-slate-500 sm:hidden">
                        {formatarData(c.start_date)} – {formatarData(c.end_date)}
                      </span>
                    </td>
                    <td className="hidden px-4 py-3 text-slate-600 sm:table-cell">
                      {formatarData(c.start_date)} – {formatarData(c.end_date)}
                    </td>
                    <td className="hidden px-4 py-3 text-slate-600 lg:table-cell">
                      {ROTULO_METRICA[c.primary_metric] ?? c.primary_metric}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${st.classe}`}>
                        {st.texto}
                      </span>
                    </td>
                    <td className="hidden px-4 py-3 text-right sm:table-cell">
                      <Link
                        href={`/campanhas/${c.id}`}
                        className="text-blue-600 hover:underline"
                      >
                        Painel
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
