import { describe, expect, it } from "vitest";
import { planejarCorrecaoInicio } from "./correcaoInicio";

// Cliente entrou pela planilha em nome da Ana em 18/09 e foi transferido
// para o Bruno com data efetiva 22/09
const ana = { id: "a", valid_from: "2026-09-18", valid_until: "2026-09-21" };
const bruno = { id: "b", valid_from: "2026-09-22", valid_until: null };

describe("planejarCorrecaoInicio", () => {
  it("data igual ao início da anterior: cancela a anterior e a vigente assume tudo", () => {
    const plano = planejarCorrecaoInicio({ vigente: bruno, anterior: ana, novaData: "2026-09-18" });
    expect(plano).toEqual({
      passos: [
        { id: "a", mudanca: { status: "CANCELLED" }, desfazer: { status: "ACTIVE" } },
        { id: "b", mudanca: { valid_from: "2026-09-18" }, desfazer: { valid_from: "2026-09-22" } },
      ],
      efeito: { tipo: "cancela_anterior" },
    });
  });

  it("antecipar: a anterior encolhe antes de a vigente avançar", () => {
    const plano = planejarCorrecaoInicio({ vigente: bruno, anterior: ana, novaData: "2026-09-20" });
    expect(plano).toEqual({
      passos: [
        { id: "a", mudanca: { valid_until: "2026-09-19" }, desfazer: { valid_until: "2026-09-21" } },
        { id: "b", mudanca: { valid_from: "2026-09-20" }, desfazer: { valid_from: "2026-09-22" } },
      ],
      efeito: { tipo: "encurta_anterior", anteriorAte: "2026-09-19" },
    });
  });

  it("adiar: a vigente recua antes de a anterior crescer", () => {
    const plano = planejarCorrecaoInicio({ vigente: bruno, anterior: ana, novaData: "2026-09-25" });
    expect(plano).toEqual({
      passos: [
        { id: "b", mudanca: { valid_from: "2026-09-25" }, desfazer: { valid_from: "2026-09-22" } },
        { id: "a", mudanca: { valid_until: "2026-09-24" }, desfazer: { valid_until: "2026-09-21" } },
      ],
      efeito: { tipo: "estende_anterior", anteriorAte: "2026-09-24" },
    });
  });

  it("sem anterior, antecipar só move o início", () => {
    // Cliente vinculado com a data do dia em vez da data de entrada
    const vigente = { id: "r", valid_from: "2026-09-05", valid_until: null };
    const plano = planejarCorrecaoInicio({ vigente, anterior: null, novaData: "2026-09-02" });
    expect(plano).toEqual({
      passos: [{ id: "r", mudanca: { valid_from: "2026-09-02" }, desfazer: { valid_from: "2026-09-05" } }],
      efeito: { tipo: "sem_anterior", lacuna: null },
    });
  });

  it("sem anterior, adiar avisa os dias que ficam sem responsável", () => {
    const vigente = { id: "r", valid_from: "2026-09-02", valid_until: null };
    const plano = planejarCorrecaoInicio({ vigente, anterior: null, novaData: "2026-09-05" });
    expect(plano).toMatchObject({
      efeito: { tipo: "sem_anterior", lacuna: { de: "2026-09-02", ate: "2026-09-04" } },
    });
  });

  it("recusa data anterior ao início do responsável anterior", () => {
    const plano = planejarCorrecaoInicio({ vigente: bruno, anterior: ana, novaData: "2026-09-17" });
    expect(plano).toEqual({
      erro: expect.stringContaining("18/09/2026"),
    });
  });

  it("recusa a própria data atual e data vazia", () => {
    expect(planejarCorrecaoInicio({ vigente: bruno, anterior: ana, novaData: "2026-09-22" })).toHaveProperty("erro");
    expect(planejarCorrecaoInicio({ vigente: bruno, anterior: ana, novaData: "" })).toHaveProperty("erro");
  });
});
