import { NextRequest, NextResponse } from "next/server";
import { obterPerfil } from "@/lib/auth";
import { carregarIntervalos, hojeISO, inicioDoMesISO } from "@/lib/dashboard";

const ROTULO_STATUS: Record<string, string> = {
  VALID: "Valido",
  NO_BASE: "Sem base",
  NEGATIVE: "Delta negativo",
  PENDING: "Pendente",
  INVALIDATED: "Invalidado",
};

/** exportação da produção detalhada em CSV (padrão pt-BR: ; e vírgula decimal). */
export async function GET(request: NextRequest) {
  const perfil = await obterPerfil();
  if (!perfil || !perfil.active || perfil.role === "SELLER") {
    return NextResponse.json(
      { code: "FORBIDDEN_OPERATION", message: "Acesso negado." },
      { status: 403 }
    );
  }

  const { searchParams } = new URL(request.url);
  const de = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.get("de") ?? "")
    ? searchParams.get("de")!
    : inicioDoMesISO();
  const ate = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.get("ate") ?? "")
    ? searchParams.get("ate")!
    : hojeISO();

  const intervalos = await carregarIntervalos(de, ate);

  const numeroBR = (n: number) => n.toFixed(2).replace(".", ",");
  const dataBR = (iso: string) => {
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
  };
  const campo = (v: string) => `"${v.replace(/"/g, '""')}"`;

  const linhas = [
    [
      "Inicio do periodo",
      "Fim do periodo",
      "Dias",
      "Codigo",
      "Cliente",
      "Vendedor",
      "VOLUME",
      "Pedidos",
      "Granularidade",
      "Status do calculo",
    ].join(";"),
    ...intervalos
      .sort(
        (a, b) =>
          a.period_end.localeCompare(b.period_end) ||
          (a.cliente?.client_code ?? "").localeCompare(
            b.cliente?.client_code ?? ""
          )
      )
      .map((i) =>
        [
          dataBR(i.period_start),
          dataBR(i.period_end),
          String(i.day_count),
          campo(i.cliente?.client_code ?? ""),
          campo(i.cliente?.display_name ?? ""),
          campo(i.seller?.name ?? ""),
          i.calculation_status === "NO_BASE" ? "" : numeroBR(i.volume_delta),
          i.calculation_status === "NO_BASE" ? "" : String(i.order_delta),
          i.granularity === "DAILY"
            ? "Diario"
            : i.granularity === "AGGREGATED"
              ? "Agregado"
              : "Sem base",
          ROTULO_STATUS[i.calculation_status] ?? i.calculation_status,
        ].join(";")
      ),
  ];

  // BOM para o Excel reconhecer UTF-8
  const csv = "﻿" + linhas.join("\r\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="producao_${de}_a_${ate}.csv"`,
    },
  });
}
