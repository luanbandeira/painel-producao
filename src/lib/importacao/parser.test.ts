import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  extrairCodigoENome,
  normalizarCabecalho,
  normalizarDocumento,
  normalizarVendedor,
  parsePlanilha,
} from "./parser";

// Planilhas fictícias geradas por scripts/gerar-planilhas.mjs (semente fixa).
// dia0 é a carga inicial (cobre 01/03); dia1 cobre 02/03.
const AMOSTRAS = join(process.cwd(), "dados-demo");
const dia0 = readFileSync(join(AMOSTRAS, "relatorio-2026-03-02.xlsx"));
const dia1 = readFileSync(join(AMOSTRAS, "relatorio-2026-03-03.xlsx"));

describe("normalizarCabecalho", () => {
  it("normaliza variações para a forma canônica", () => {
    expect(normalizarCabecalho("Última Compra")).toBe("ULTIMA_COMPRA");
    expect(normalizarCabecalho("UltimaCompra")).toBe("ULTIMA_COMPRA");
    expect(normalizarCabecalho("CNPJ/CPF")).toBe("CNPJ_CPF");
    expect(normalizarCabecalho("CNPJ_CPF")).toBe("CNPJ_CPF");
    expect(normalizarCabecalho(" Volume ")).toBe("VOLUME");
    expect(normalizarCabecalho("Canal")).toBe("CANAL");
  });
});

describe("extrairCodigoENome", () => {
  it("separa código e nome preservando zeros à esquerda", () => {
    expect(extrairCodigoENome("0001234-Padaria Exemplo")).toEqual({
      codigo: "0001234",
      nome: "Padaria Exemplo",
    });
  });

  it("retorna código nulo quando não extraível", () => {
    expect(extrairCodigoENome("Sem Codigo Ltda").codigo).toBeNull();
  });
});

describe("normalizarDocumento", () => {
  it("remove máscara e preserva como texto", () => {
    expect(normalizarDocumento("12.345.678/0001-90")).toBe("12345678000190");
    expect(normalizarDocumento("123.456.789-09")).toBe("12345678909");
    expect(normalizarDocumento("")).toBeNull();
  });

  it("restaura zeros à esquerda perdidos pelo Excel", () => {
    // CNPJ 05.123.456/0001-78 lido como número -> 5123456000178 (13 dígitos)
    expect(normalizarDocumento(5123456000178)).toBe("05123456000178");
    expect(normalizarDocumento("512345600017")).toBe("00512345600017");
    // CPF 012.345.678-90 lido como número -> 1234567890 (10 dígitos)
    expect(normalizarDocumento(1234567890)).toBe("01234567890");
    // Comprimentos corretos não são alterados
    expect(normalizarDocumento("12345678909")).toBe("12345678909");
    expect(normalizarDocumento("12345678000190")).toBe("12345678000190");
  });

  it("aponta só o documento inválido plantado nas planilhas de demonstração", () => {
    for (const arquivo of [dia0, dia1]) {
      const r = parsePlanilha(arquivo);
      const avisos = r.linhas.filter((l) =>
        l.normalizado.problemas.some((p) => p.tipo === "INVALID_DOCUMENT")
      );
      expect(avisos).toHaveLength(1);
      expect(avisos[0].status).toBe("WARNING");
    }
  });
});

describe("normalizarVendedor", () => {
  it("trata vazio, espaços, '0' e 0 como não informado", () => {
    expect(normalizarVendedor("")).toBeNull();
    expect(normalizarVendedor("   ")).toBeNull();
    expect(normalizarVendedor("0")).toBeNull();
    expect(normalizarVendedor(0)).toBeNull();
    expect(normalizarVendedor(null)).toBeNull();
    expect(normalizarVendedor("Ana Paula")).toBe("Ana Paula");
  });
});

describe("parsePlanilha com as planilhas de demonstração", () => {
  it("lê as 40 linhas da carga inicial", () => {
    const r = parsePlanilha(dia0, "2026-03-01");
    expect(r.ok).toBe(true);
    expect(r.colunasFaltantes).toEqual([]);
    expect(r.linhas).toHaveLength(40);
    expect(r.linhas.filter((l) => l.status === "ERROR")).toHaveLength(0);
  });

  it("lê as 43 linhas do dia seguinte", () => {
    const r = parsePlanilha(dia1, "2026-03-02");
    expect(r.ok).toBe(true);
    expect(r.linhas).toHaveLength(43);
    expect(r.linhas.filter((l) => l.status === "ERROR")).toHaveLength(0);
  });

  it("calcula o delta de referência entre os dois dias", () => {
    const r0 = parsePlanilha(dia0);
    const r1 = parsePlanilha(dia1);
    const mapa0 = new Map(
      r0.linhas.map((l) => [l.normalizado.client_code, l.normalizado])
    );

    let deltaVolume = 0;
    let deltaTx = 0;
    let comAumento = 0;
    let novos = 0;

    for (const l of r1.linhas) {
      const ant = mapa0.get(l.normalizado.client_code);
      if (!ant) {
        novos++;
        continue;
      }
      const dt = (l.normalizado.cumulative_volume ?? 0) - (ant.cumulative_volume ?? 0);
      const dx =
        (l.normalizado.cumulative_orders ?? 0) -
        (ant.cumulative_orders ?? 0);
      if (dt > 0) comAumento++;
      deltaVolume += dt;
      deltaTx += dx;
    }

    expect(novos).toBe(3);
    expect(comAumento).toBe(17);
    expect(deltaVolume).toBeCloseTo(19509.97, 2);
    expect(deltaTx).toBe(208);

    // Cliente-âncora: Padaria Exemplo
    const ancora0 = mapa0.get("0001234")!;
    const ancora1 = r1.linhas.find(
      (l) => l.normalizado.client_code === "0001234"
    )!.normalizado;
    expect(ancora1.cumulative_volume! - ancora0.cumulative_volume!).toBeCloseTo(976.57, 2);
    expect(
      ancora1.cumulative_orders! - ancora0.cumulative_orders!
    ).toBe(132);
  });

  it("identifica vendedores não informados (vazio e \"0\")", () => {
    const r = parsePlanilha(dia1);
    const semVendedor = r.linhas.filter(
      (l) => l.normalizado.seller_text === null
    );
    expect(semVendedor.length).toBe(2);
  });

  it("extrai datas de última compra como ISO", () => {
    const r = parsePlanilha(dia1);
    const datas = r.linhas
      .map((l) => l.normalizado.last_purchase_date)
      .filter(Boolean) as string[];
    expect(datas.length).toBeGreaterThan(0);
    expect(Math.max(...datas.map((d) => Date.parse(d)))).toBe(
      Date.parse("2026-03-02") // maior UltimaCompra do relatório que cobre 02/03
    );
    for (const d of datas) expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
