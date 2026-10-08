import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parsePlanilha } from "@/lib/importacao/parser";
import {
  calcularProducao,
  diferencaDias,
  somarDias,
  type AtribuicaoMotor,
  type SnapshotMotor,
} from "./motor";

let seq = 0;
function snap(parcial: Partial<SnapshotMotor> & Pick<SnapshotMotor, "clientId" | "coverageEndDate" | "volume" | "pedidos">): SnapshotMotor {
  seq += 1;
  return {
    snapshotId: parcial.snapshotId ?? `snap-${seq}`,
    importId: parcial.importId ?? `imp-${parcial.coverageEndDate}`,
    ...parcial,
  };
}

describe("aritmética de datas", () => {
  it("soma e subtrai dias sem efeito de fuso", () => {
    expect(somarDias("2026-07-28", 1)).toBe("2026-07-29");
    expect(somarDias("2026-07-31", 1)).toBe("2026-08-01");
    expect(diferencaDias("2026-07-28", "2026-07-29")).toBe(1);
    expect(diferencaDias("2026-07-28", "2026-07-30")).toBe(2);
  });
});

describe("Cenário 1 — upload normal (produção diária válida)", () => {
  it("Volume 1000 -> 1250 em coberturas consecutivas gera produção de 250", () => {
    const r = calcularProducao(
      [
        snap({ clientId: "c1", coverageEndDate: "2026-07-28", volume: 1000, pedidos: 10 }),
        snap({ clientId: "c1", coverageEndDate: "2026-07-29", volume: 1250, pedidos: 14 }),
      ],
      []
    );
    // primeiro snapshot = sem base; segundo = diário válido
    expect(r.intervalos).toHaveLength(2);
    const diario = r.intervalos.find((i) => i.calculationStatus === "VALID")!;
    expect(diario.volumeDelta).toBe(250);
    expect(diario.orderDelta).toBe(4);
    expect(diario.granularity).toBe("DAILY");
    expect(diario.dayCount).toBe(1);
    expect(diario.periodStart).toBe("2026-07-29");
    expect(diario.periodEnd).toBe("2026-07-29");
  });
});

describe("Cliente novo — acumulado vai para a data da última compra", () => {
  // Regra ajustada no uso real.
  // "base" existe desde 28/07 e serve só para marcar a carga inicial do
  // sistema: assim "c1", que aparece em 29/07, é captação de verdade.
  const cargaInicial = snap({
    clientId: "base",
    coverageEndDate: "2026-07-28",
    volume: 0,
    pedidos: 0,
  });
  const doCliente = (r: ReturnType<typeof calcularProducao>) =>
    r.intervalos.filter((i) => i.clientId === "c1");

  it("lança o acumulado no dia da última compra, não no da aparição", () => {
    const r = calcularProducao(
      [
        cargaInicial,
        snap({
          clientId: "c1",
          coverageEndDate: "2026-07-29",
          volume: 16,
          pedidos: 2,
          ultimaCompra: "2026-07-02",
        }),
      ],
      []
    );
    const [i] = doCliente(r);
    expect(i.calculationStatus).toBe("VALID");
    expect(i.volumeDelta).toBe(16);
    expect(i.orderDelta).toBe(2);
    expect(i.periodStart).toBe("2026-07-02"); // dia do movimento
    expect(i.periodEnd).toBe("2026-07-02");
    expect(i.granularity).toBe("DAILY");
    expect(r.pendencias.filter((p) => p.clientId === "c1")).toHaveLength(0);
  });

  it("usa a cobertura quando a última compra vem à frente dela", () => {
    const r = calcularProducao(
      [
        cargaInicial,
        snap({
          clientId: "c1",
          coverageEndDate: "2026-07-29",
          volume: 100,
          pedidos: 1,
          ultimaCompra: "2026-08-15", // inconsistente com a cobertura
        }),
      ],
      []
    );
    const [i] = doCliente(r);
    expect(i.periodEnd).toBe("2026-07-29");
    expect(i.volumeDelta).toBe(100);
  });

  it("atribui ao responsável vigente na data do movimento", () => {
    const r = calcularProducao(
      [
        cargaInicial,
        snap({
          clientId: "c1",
          coverageEndDate: "2026-07-29",
          volume: 50,
          pedidos: 1,
          ultimaCompra: "2026-07-10",
        }),
      ],
      [
        { clientId: "c1", sellerId: "bruno", validFrom: "2026-07-01", validUntil: null },
      ]
    );
    expect(doCliente(r)[0].assignedSellerId).toBe("bruno");
  });

  it("sem data de última compra, continua sem base e gera pendência", () => {
    const r = calcularProducao(
      [
        cargaInicial,
        snap({ clientId: "c1", coverageEndDate: "2026-07-29", volume: 500, pedidos: 5 }),
      ],
      []
    );
    const [i] = doCliente(r);
    expect(i.calculationStatus).toBe("NO_BASE");
    expect(i.volumeDelta).toBeNull();
    expect(i.granularity).toBe("UNKNOWN");
    expect(r.pendencias.filter((p) => p.clientId === "c1")).toHaveLength(1);
  });

  it("cliente novo com acumulado zero não vira produção", () => {
    const r = calcularProducao(
      [
        cargaInicial,
        snap({
          clientId: "c1",
          coverageEndDate: "2026-07-29",
          volume: 0,
          pedidos: 0,
          ultimaCompra: "2026-07-20",
        }),
      ],
      []
    );
    expect(doCliente(r)[0].calculationStatus).toBe("NO_BASE");
  });

  it("a carga inicial do sistema nunca vira produção", () => {
    // Os clientes da primeira cobertura trazem acumulado histórico, anterior
    // ao sistema — contá-lo lançaria meses de movimento num único dia.
    const r = calcularProducao(
      [
        snap({
          clientId: "antigo",
          coverageEndDate: "2026-07-28",
          volume: 25000,
          pedidos: 900,
          ultimaCompra: "2026-07-28",
        }),
      ],
      []
    );
    expect(r.intervalos[0].calculationStatus).toBe("NO_BASE");
    expect(r.intervalos[0].volumeDelta).toBeNull();
  });
});

describe("Cenário 3 — dia faltante gera intervalo agregado", () => {
  it("28/07 e 30/07 sem 29/07 = intervalo de 2 dias, sem divisão", () => {
    const r = calcularProducao(
      [
        snap({ clientId: "c1", coverageEndDate: "2026-07-28", volume: 100, pedidos: 1 }),
        snap({ clientId: "c1", coverageEndDate: "2026-07-30", volume: 400, pedidos: 7 }),
      ],
      []
    );
    const agregado = r.intervalos.find((i) => i.granularity === "AGGREGATED")!;
    expect(agregado.calculationStatus).toBe("VALID");
    expect(agregado.periodStart).toBe("2026-07-29");
    expect(agregado.periodEnd).toBe("2026-07-30");
    expect(agregado.dayCount).toBe(2);
    expect(agregado.volumeDelta).toBe(300); // total do intervalo, nunca dividido
    expect(agregado.orderDelta).toBe(6);
  });
});

describe("Delta negativo", () => {
  it("gera status NEGATIVE e pendência bloqueante, sem lançar produção", () => {
    const r = calcularProducao(
      [
        snap({ clientId: "c1", coverageEndDate: "2026-07-28", volume: 1000, pedidos: 10 }),
        snap({ clientId: "c1", coverageEndDate: "2026-07-29", volume: 900, pedidos: 12 }),
      ],
      []
    );
    const negativo = r.intervalos.find((i) => i.calculationStatus === "NEGATIVE")!;
    expect(negativo.volumeDelta).toBe(-100);
    expect(negativo.assignedSellerId).toBeNull();
    const pendencia = r.pendencias.find((p) => p.tipo === "NEGATIVE_VOLUME")!;
    expect(pendencia.severidade).toBe("BLOCKING");
  });

  it("pedidos negativos também bloqueiam", () => {
    const r = calcularProducao(
      [
        snap({ clientId: "c1", coverageEndDate: "2026-07-28", volume: 100, pedidos: 10 }),
        snap({ clientId: "c1", coverageEndDate: "2026-07-29", volume: 200, pedidos: 8 }),
      ],
      []
    );
    expect(r.pendencias.some((p) => p.tipo === "NEGATIVE_ORDERS")).toBe(true);
  });
});

describe("Produção por responsável", () => {
  const atribuicoes: AtribuicaoMotor[] = [
    { clientId: "c1", sellerId: "bruno", validFrom: "2026-07-01", validUntil: "2026-07-28" },
    { clientId: "c1", sellerId: "carla", validFrom: "2026-07-29", validUntil: null },
  ];

  it("atribui a produção ao responsável válido na data da produção", () => {
    const r = calcularProducao(
      [
        snap({ clientId: "c1", coverageEndDate: "2026-07-27", volume: 0, pedidos: 0 }),
        snap({ clientId: "c1", coverageEndDate: "2026-07-28", volume: 50, pedidos: 1 }),
        snap({ clientId: "c1", coverageEndDate: "2026-07-29", volume: 150, pedidos: 3 }),
      ],
      atribuicoes
    );
    const dia28 = r.intervalos.find((i) => i.periodEnd === "2026-07-28")!;
    const dia29 = r.intervalos.find((i) => i.periodEnd === "2026-07-29")!;
    expect(dia28.assignedSellerId).toBe("bruno");
    expect(dia29.assignedSellerId).toBe("carla");
  });

  it("intervalo agregado cruzando a troca vai inteiro para quem assumiu", () => {
    // Regra ajustada no uso real: o total do intervalo
    // pertence ao responsável do último dia, sem divisão e sem pendência.
    const r = calcularProducao(
      [
        snap({ clientId: "c1", coverageEndDate: "2026-07-27", volume: 0, pedidos: 0 }),
        snap({ clientId: "c1", coverageEndDate: "2026-07-30", volume: 300, pedidos: 6 }),
      ],
      atribuicoes
    );
    const agregado = r.intervalos.find((i) => i.granularity === "AGGREGATED")!;
    expect(agregado.calculationStatus).toBe("VALID");
    expect(agregado.assignedSellerId).toBe("carla"); // assumiu em 29/07
    expect(agregado.volumeDelta).toBe(300); // valor íntegro, nunca dividido
    expect(agregado.dayCount).toBe(3);
    expect(r.pendencias.some((p) => p.tipo === "AGGREGATED_TRANSFER")).toBe(false);
  });
});

describe("Base zero confirmada", () => {
  it("acumulado vira produção do dia quando o administrador confirma", () => {
    const s = snap({
      snapshotId: "sz-1",
      clientId: "c1",
      coverageEndDate: "2026-07-29",
      volume: 500,
      pedidos: 5,
    });
    const r = calcularProducao([s], [], {
      basesZeroConfirmadas: new Set(["sz-1"]),
    });
    expect(r.intervalos).toHaveLength(1);
    expect(r.intervalos[0].calculationStatus).toBe("VALID");
    expect(r.intervalos[0].volumeDelta).toBe(500);
    expect(r.intervalos[0].orderDelta).toBe(5);
    expect(r.pendencias).toHaveLength(0); // não recria pendência de base
  });

  it("sem confirmação, o mesmo snapshot continua sem base", () => {
    const s = snap({
      snapshotId: "sz-2",
      clientId: "c1",
      coverageEndDate: "2026-07-29",
      volume: 500,
      pedidos: 5,
    });
    const r = calcularProducao([s], []);
    expect(r.intervalos[0].calculationStatus).toBe("NO_BASE");
  });
});

describe("Idempotência", () => {
  it("mesma entrada produz exatamente a mesma saída", () => {
    const snaps = [
      snap({ snapshotId: "a", clientId: "c1", coverageEndDate: "2026-07-28", volume: 10, pedidos: 1 }),
      snap({ snapshotId: "b", clientId: "c1", coverageEndDate: "2026-07-29", volume: 20, pedidos: 2 }),
    ];
    expect(calcularProducao(snaps, [])).toEqual(calcularProducao(snaps, []));
  });
});

describe("Planilhas de demonstração: carga inicial e dia seguinte", () => {
  // Geradas por scripts/gerar-planilhas.mjs (semente fixa).
  const dir = join(process.cwd(), "dados-demo");
  const r0 = parsePlanilha(readFileSync(join(dir, "relatorio-2026-03-02.xlsx")));
  const r1 = parsePlanilha(readFileSync(join(dir, "relatorio-2026-03-03.xlsx")));

  // Simula os dois uploads confirmados: cobertura 01/03 e 02/03 (D+1)
  const clientes = new Map<string, string>(); // code -> clientId
  const snapshots: SnapshotMotor[] = [];
  for (const [resultado, cobertura, imp] of [
    [r0, "2026-03-01", "imp0"],
    [r1, "2026-03-02", "imp1"],
  ] as const) {
    for (const linha of resultado.linhas) {
      const code = linha.normalizado.client_code!;
      if (!clientes.has(code)) clientes.set(code, `cli-${code}`);
      snapshots.push({
        snapshotId: `${imp}-${code}`,
        importId: imp,
        clientId: clientes.get(code)!,
        coverageEndDate: cobertura,
        volume: linha.normalizado.cumulative_volume!,
        pedidos: linha.normalizado.cumulative_orders!,
        ultimaCompra: linha.normalizado.last_purchase_date,
      });
    }
  }

  const r = calcularProducao(snapshots, []);

  it("os 40 da carga inicial ficam sem base e os 3 novos entram", () => {
    const validos = r.intervalos.filter((i) => i.calculationStatus === "VALID");
    const semBase = r.intervalos.filter((i) => i.calculationStatus === "NO_BASE");
    expect(semBase).toHaveLength(40); // carga inicial: acumulado histórico
    expect(validos).toHaveLength(43); // 40 deltas + 3 clientes captados
    expect(validos.every((i) => i.granularity === "DAILY")).toBe(true);
    expect(r.intervalos.some((i) => i.calculationStatus === "NEGATIVE")).toBe(false);
  });

  it("o delta dos clientes com base é R$ 19.509,97 e 208 pedidos", () => {
    const comBase = r.intervalos.filter(
      (i) => i.calculationStatus === "VALID" && i.previousSnapshotId !== null
    );
    const volume = comBase.reduce((s, i) => s + (i.volumeDelta ?? 0), 0);
    const tx = comBase.reduce((s, i) => s + (i.orderDelta ?? 0), 0);
    expect(volume).toBeCloseTo(19509.97, 2);
    expect(tx).toBe(208);
    expect(comBase.every((i) => i.periodEnd === "2026-03-02")).toBe(true);
  });

  it("o cliente-âncora produz R$ 976,57 e 132 pedidos", () => {
    const ancora = r.intervalos.find(
      (i) => i.clientId === "cli-0001234" && i.calculationStatus === "VALID"
    )!;
    expect(ancora.volumeDelta).toBeCloseTo(976.57, 2);
    expect(ancora.orderDelta).toBe(132);
  });

  it("os 3 clientes novos entram na data da própria última compra", () => {
    // Dois compraram em 02/03; o terceiro só tem uma compra de 01/03, e o
    // acumulado dele é lançado no dia do movimento.
    const dosNovos = r.intervalos.filter(
      (i) => i.previousSnapshotId === null && i.calculationStatus === "VALID"
    );
    expect(dosNovos).toHaveLength(3);

    const soma = dosNovos.reduce((s, i) => s + (i.volumeDelta ?? 0), 0);
    expect(soma).toBeCloseTo(28, 2); // R$ 28,00 de acumulado dos 3 novos

    // O que veio de 01/03 é datado lá, e não em 02/03
    const antigo = dosNovos.find((i) => i.periodEnd === "2026-03-01");
    expect(antigo).toBeDefined();
    expect(antigo!.volumeDelta).toBeCloseTo(16, 2);
  });

  it("o delta dos clientes com base não é afetado pela regra dos novos", () => {
    const validosComBase = r.intervalos.filter(
      (i) => i.previousSnapshotId !== null && i.calculationStatus === "VALID"
    );
    const volume = validosComBase.reduce((s, i) => s + (i.volumeDelta ?? 0), 0);
    expect(volume).toBeCloseTo(19509.97, 2);
  });
});
