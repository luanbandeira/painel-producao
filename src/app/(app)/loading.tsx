/**
 * Esqueleto exibido enquanto a próxima tela é montada no servidor.
 *
 * Sem ele o navegador ficava parado na tela anterior até a resposta chegar —
 * o clique parecia não ter funcionado. Com o limite de carregamento, a troca
 * é imediata: o menu já mudou, o conteúdo aparece em seguida. De quebra, é o
 * que permite ao Next pré-carregar a casca das telas do menu antes do clique.
 */
export default function Carregando() {
  return (
    <div className="animate-pulse" aria-busy="true" aria-live="polite">
      <span className="sr-only">Carregando…</span>

      {/* Título da página */}
      <div className="mb-6">
        <div className="h-7 w-56 rounded bg-slate-200" />
        <div className="mt-2 h-4 w-80 max-w-full rounded bg-slate-100" />
      </div>

      {/* Faixa de cartões */}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="rounded-lg border border-slate-200 bg-white px-4 py-5"
          >
            <div className="h-3 w-24 rounded bg-slate-100" />
            <div className="mt-3 h-6 w-28 rounded bg-slate-200" />
          </div>
        ))}
      </div>

      {/* Tabela */}
      <div className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3">
          <div className="h-3 w-32 rounded bg-slate-100" />
        </div>
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-4 border-b border-slate-100 px-4 py-3 last:border-0"
          >
            <div className="h-4 flex-1 rounded bg-slate-100" />
            <div className="hidden h-4 w-24 rounded bg-slate-100 sm:block" />
            <div className="h-4 w-20 rounded bg-slate-100" />
          </div>
        ))}
      </div>
    </div>
  );
}
