import { describe, expect, it } from "vitest";
import { avaliarPrevia, type ResumoPrevia } from "./previaUpload";

// Um dia normal, medido nos uploads reais: ~196 linhas, às vezes um cliente
// novo, nada mais
const diaNormal: ResumoPrevia = {
  linhas: 196,
  novos: 0,
  ausentes: 0,
  semVendedor: 0,
  desconhecidos: 0,
  negativos: 0,
  comProblema: 0,
  temBase: true,
};

describe("avaliarPrevia", () => {
  it("dia normal está pronto para confirmar", () => {
    const v = avaliarPrevia(diaNormal);
    expect(v.pronto).toBe(true);
    expect(v.avisos).toEqual([]);
    expect(v.resumo).toBe("196 linhas");
  });

  it("cliente novo e ausente são rotina, não alerta", () => {
    const v = avaliarPrevia({ ...diaNormal, novos: 4, ausentes: 2 });
    expect(v.pronto).toBe(true);
    expect(v.resumo).toBe("196 linhas · 4 clientes novos · 2 ausentes");
  });

  it("um cliente novo no singular", () => {
    expect(avaliarPrevia({ ...diaNormal, novos: 1 }).resumo).toBe("196 linhas · 1 cliente novo");
  });

  it("vendedor desconhecido pede atenção, sem impedir", () => {
    const v = avaliarPrevia({ ...diaNormal, desconhecidos: 2 });
    expect(v.pronto).toBe(false);
    expect(v.avisos.map((a) => a.chave)).toEqual(["desconhecidos"]);
    expect(v.avisos[0].texto).toContain("2 nomes");
  });

  it("delta negativo pede atenção", () => {
    expect(avaliarPrevia({ ...diaNormal, negativos: 1 }).pronto).toBe(false);
  });

  it("linha ilegível pede atenção", () => {
    expect(avaliarPrevia({ ...diaNormal, comProblema: 3 }).pronto).toBe(false);
  });

  it("linha sem vendedor pede atenção", () => {
    expect(avaliarPrevia({ ...diaNormal, semVendedor: 1 }).pronto).toBe(false);
  });

  it("primeiro upload do sistema pede atenção: não há base para comparar", () => {
    const v = avaliarPrevia({ ...diaNormal, temBase: false });
    expect(v.pronto).toBe(false);
    expect(v.avisos[0].chave).toBe("semBase");
  });

  it("acumula todos os avisos do arquivo", () => {
    const v = avaliarPrevia({
      ...diaNormal,
      desconhecidos: 1,
      negativos: 2,
      comProblema: 1,
      semVendedor: 1,
      temBase: false,
    });
    expect(v.avisos.map((a) => a.chave)).toEqual([
      "semBase",
      "desconhecidos",
      "negativos",
      "problemas",
      "semVendedor",
    ]);
  });
});
