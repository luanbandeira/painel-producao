import { ROTULO_PAPEL, type Papel } from "@/types/database";

/**
 * Saudação do dashboard, no lugar onde antes ficava o botão de exportar.
 *
 * A hora é a de Recife, como todo o resto do sistema (`hojeISO`), e não a do
 * servidor: na Vercel o processo roda em UTC e daria "boa noite" às cinco da
 * tarde.
 */
function horaLocal(): number {
  const h = new Date().toLocaleString("en-US", {
    timeZone: "America/Recife",
    hour: "2-digit",
    hour12: false,
  });
  // Meia-noite sai como "24" em algumas versões do ICU
  return Number(h) % 24;
}

export function Saudacao({ nome, papel }: { nome: string; papel: Papel }) {
  const hora = horaLocal();
  const saudacao =
    hora < 12 ? "Bom dia" : hora < 18 ? "Boa tarde" : "Boa noite";

  // Só o primeiro nome: "Boa tarde, Ana" soa como alguém falando; o nome
  // completo soa como um cadastro. O papel logo abaixo dá o resto do contexto.
  const primeiro = nome.trim().split(/\s+/)[0] || nome;

  return (
    <div className="sm:text-right">
      <p className="text-base font-semibold text-slate-900 sm:text-lg">
        {saudacao}, {primeiro}
      </p>
      <p className="text-sm text-slate-500">{ROTULO_PAPEL[papel]}</p>
    </div>
  );
}
