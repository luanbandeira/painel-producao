"use client";

import { useState } from "react";

/**
 * Escolha do nome que a planilha usa para um vendedor.
 *
 * Lista os nomes que a fonte realmente enviou e que ainda não pertencem a
 * ninguém, em vez de pedir para digitar. Digitar é o que quebra: o alias só
 * casa se for idêntico ao texto da planilha, inclusive nos erros dela — há
 * um "MARIA APARECIDA FOS SANTOS" na base, com o "DOS" escrito errado pela
 * fonte, que precisou ser cadastrado com o erro.
 *
 * A opção de digitar continua, para o caso de já se saber de um nome que
 * ainda não apareceu em upload nenhum.
 */
export function CampoAlias({
  nomes,
  campo = "alias",
  obrigatorio = false,
  rotulo = "Nome como aparece na planilha",
  ajuda,
}: {
  /** Nomes da planilha ainda sem dono. */
  nomes: string[];
  /** Nome do campo enviado no formulário. */
  campo?: string;
  obrigatorio?: boolean;
  rotulo?: string;
  ajuda?: string;
}) {
  const semSugestoes = nomes.length === 0;
  const [manual, setManual] = useState(semSugestoes);

  const classe =
    "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

  return (
    <div>
      <label htmlFor={campo} className="block text-sm font-medium text-slate-700">
        {rotulo}
        {obrigatorio && " *"}
      </label>

      {manual ? (
        <input
          id={campo}
          name={campo}
          required={obrigatorio}
          placeholder="Digite exatamente como vem na planilha"
          className={classe}
        />
      ) : (
        <select
          id={campo}
          name={campo}
          required={obrigatorio}
          defaultValue=""
          className={classe}
        >
          <option value="">
            {obrigatorio ? "Selecione o nome..." : "Nenhum por enquanto"}
          </option>
          {nomes.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      )}

      <p className="mt-1 text-xs text-slate-600">
        {ajuda ??
          "O alias precisa ser idêntico ao texto da planilha — inclusive erros de digitação da fonte."}
        {!semSugestoes && (
          <>
            {" "}
            {manual
              ? "Prefira escolher da lista: "
              : `${nomes.length} nome(s) sem dono na lista. `}
            <button
              type="button"
              onClick={() => setManual((m) => !m)}
              className="text-blue-600 underline"
            >
              {manual ? "voltar para a lista" : "ou digitar outro nome"}
            </button>
          </>
        )}
        {semSugestoes &&
          " Nenhum nome órfão na planilha no momento, então o campo é livre."}
      </p>
    </div>
  );
}
