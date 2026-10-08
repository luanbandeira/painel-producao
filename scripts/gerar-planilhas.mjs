// Gera as planilhas diárias FICTÍCIAS usadas pelo seed e pelos testes.
//
// Uso: node scripts/gerar-planilhas.mjs [--inicio=AAAA-MM-DD] [--saida=pasta]
// Saída: relatorio-AAAA-MM-DD.xlsx (uma por dia), por padrão em dados-demo/
//
// Sem argumentos gera as planilhas fixas de março/2026 que os testes usam.
// O seed passa --inicio para que a demonstração termine sempre "ontem": as
// datas mudam, mas os valores são os mesmos, porque o sorteio não depende
// delas.
//
// Cada relatório tem a data do dia em que foi "enviado" e cobre o dia
// anterior (D+1), com valores ACUMULADOS por cliente — o mesmo formato que o
// sistema recebe em produção. Todos os nomes, documentos e valores são
// inventados e gerados por um sorteio com semente fixa: rodar de novo produz
// exatamente os mesmos arquivos, e é isso que permite aos testes conferirem
// números exatos.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as XLSX from "xlsx";

const argumento = (nome) =>
  process.argv.find((a) => a.startsWith(`--${nome}=`))?.split("=")[1];
const SAIDA = join(process.cwd(), argumento("saida") ?? "dados-demo");
const PRIMEIRA_COBERTURA = argumento("inicio") ?? "2026-03-01"; // carga inicial
const DIAS = 30; // trinta coberturas diárias a partir da carga inicial

// ---------------------------------------------------------------- sorteio
function mulberry32(semente) {
  return () => {
    semente |= 0;
    semente = (semente + 0x6d2b79f5) | 0;
    let t = Math.imul(semente ^ (semente >>> 15), 1 | semente);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260301);
const entre = (min, max) => min + Math.floor(rnd() * (max - min + 1));
const escolher = (lista) => lista[Math.floor(rnd() * lista.length)];
const centavos = (v) => Math.round(v * 100) / 100;

// ---------------------------------------------------------------- datas
function somarDias(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function diasEntre(de, ate) {
  return Math.round((Date.parse(ate) - Date.parse(de)) / 86400000);
}
const dataUTC = (iso) => new Date(`${iso}T00:00:00Z`);

// ---------------------------------------------------------------- documentos
// O último dígito verificador é deslocado de propósito: os números têm o
// formato certo, mas são inválidos, e por isso nunca coincidem com o CNPJ
// ou o CPF de alguém de verdade. (O sistema só confere a quantidade de
// dígitos, então isso não muda nada no comportamento.)
const invalidar = (d) => (d + 1) % 10;
function dvCnpj(base) {
  const calc = (nums, pesos) => {
    const s = nums.reduce((acc, n, i) => acc + n * pesos[i], 0) % 11;
    return s < 2 ? 0 : 11 - s;
  };
  const n = base.split("").map(Number);
  const d1 = calc(n, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = calc([...n, d1], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${d1}${invalidar(d2)}`;
}
function cnpjFicticio() {
  const raiz = String(entre(10000000, 99999999));
  const base = `${raiz}0001`;
  const c = base + dvCnpj(base);
  return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;
}
function cpfFicticio() {
  const n = Array.from({ length: 9 }, () => entre(0, 9));
  const dv = (arr, peso) => {
    const s = arr.reduce((acc, x, i) => acc + x * (peso - i), 0) % 11;
    return s < 2 ? 0 : 11 - s;
  };
  const d1 = dv(n, 10);
  const d2 = dv([...n, d1], 11);
  const c = [...n, d1, invalidar(d2)].join("");
  return `${c.slice(0, 3)}.${c.slice(3, 6)}.${c.slice(6, 9)}-${c.slice(9)}`;
}

// ---------------------------------------------------------------- cadastros
const VENDEDORES = ["ANA PAULA REIS", "BRUNO COSTA LIMA", "CARLA MENDES"];
const VENDEDOR_NOVO = "DIEGO FARIAS"; // aparece no meio do mês, sem cadastro
const PLANOS = ["Básico", "Básico", "Plus", "Plus", "Premium"];
const CANAIS = ["Loja física", "Online", "Televendas"];
const UNIDADES = ["Unidade Centro", "Unidade Norte", "Unidade Sul"];
const UFS = ["SP", "MG", "PR", "RS", "SC", "GO", "BA", "RJ"];
const TIPOS = [
  "Padaria", "Mercado", "Papelaria", "Pet Shop", "Restaurante", "Lanchonete",
  "Ótica", "Livraria", "Floricultura", "Hortifruti", "Barbearia", "Academia",
  "Empório", "Sorveteria", "Bazar", "Doceria",
];
const NOMES = [
  "Aurora", "Horizonte", "Primavera", "Bela Vista", "Estrela", "Jardim",
  "Alvorada", "Boa Esperança", "Sol Nascente", "Bem-te-vi", "Recanto",
  "Nova Era", "Bom Sabor", "Vila Rica", "Mar Azul", "Serra Verde",
];

let proximoCodigo = 1001;
const usados = new Set();
function novoCliente({ nome, perfil, historico = true } = {}) {
  let n = nome;
  while (!n || usados.has(n)) n = `${escolher(TIPOS)} ${escolher(NOMES)}`;
  usados.add(n);
  return {
    codigo: String(proximoCodigo++).padStart(7, "0"),
    nome: n,
    documento: rnd() < 0.8 ? cnpjFicticio() : cpfFicticio(),
    vendedor: escolher(VENDEDORES),
    unidade: escolher(UNIDADES),
    uf: escolher(UFS),
    situacao: "Ativo",
    plano: escolher(PLANOS),
    canal: escolher(CANAIS),
    // probabilidade de comprar em um dia: constante, eventual ou parado
    perfil: perfil ?? escolher(["constante", "eventual", "eventual", "parado"]),
    volume: historico ? centavos(entre(2000, 90000) + rnd()) : 0,
    pedidos: historico ? entre(20, 900) : 0,
    ultimaCompra: historico ? somarDias(PRIMEIRA_COBERTURA, -entre(0, 20)) : null,
  };
}

// Cliente-âncora dos testes: valores redondos e conhecidos.
const ancora = novoCliente({ nome: "Padaria Exemplo", perfil: "constante" });
ancora.codigo = "0001234";
ancora.volume = 1000;
ancora.pedidos = 10;
ancora.ultimaCompra = PRIMEIRA_COBERTURA;

const clientes = [ancora];
for (let i = 0; i < 39; i++) clientes.push(novoCliente());

// Casos que a demonstração precisa mostrar
clientes[5].vendedor = ""; // sem vendedor: vai para a fila de atribuição
clientes[6].vendedor = "0"; // "0" também significa não informado
clientes[7].documento = "1234567"; // documento inválido: pendência de aviso
clientes[8].perfil = "parado"; // alimenta a tela "Atenção"
clientes[9].perfil = "parado";

const PROB = { constante: 0.8, eventual: 0.3, parado: 0 };

// Entradas programadas: [dia (0 = primeira cobertura), cliente]
const entradas = new Map();
function agendarEntrada(dia, cliente) {
  if (!entradas.has(dia)) entradas.set(dia, []);
  entradas.get(dia).push(cliente);
}
// Dia 1: três clientes novos. Dois compraram no próprio dia; o terceiro só
// tem uma compra do dia anterior ao que apareceu — o sistema deve lançar a
// produção dele na data dessa compra, não no dia em que apareceu.
agendarEntrada(1, { ...novoCliente({ historico: false, perfil: "eventual" }), _primeira: { volume: 7, pedidos: 1, data: "dia" } });
agendarEntrada(1, { ...novoCliente({ historico: false, perfil: "constante" }), _primeira: { volume: 5, pedidos: 1, data: "dia" } });
agendarEntrada(1, { ...novoCliente({ historico: false, perfil: "eventual" }), _primeira: { volume: 16, pedidos: 2, data: PRIMEIRA_COBERTURA } });
// Captação ao longo do mês
// (valores fixos, sem sorteio, para não alterar a sequência dos outros dados)
for (const dia of [6, 11, 15, 20, 24]) {
  agendarEntrada(dia, {
    ...novoCliente({ historico: false, perfil: "eventual" }),
    _primeira: { volume: 100 + dia * 10, pedidos: 2, data: "dia" },
  });
}
// Vendedor novo, ainda sem cadastro: gera pendência de vendedor desconhecido
const doVendedorNovo = novoCliente({ historico: false, perfil: "constante" });
doVendedorNovo.vendedor = VENDEDOR_NOVO;
agendarEntrada(18, { ...doVendedorNovo, _primeira: { volume: 340, pedidos: 3, data: "dia" } });

// ---------------------------------------------------------------- simulação
mkdirSync(SAIDA, { recursive: true });
const ativos = [...clientes];

for (let dia = 0; dia < DIAS; dia++) {
  const cobertura = somarDias(PRIMEIRA_COBERTURA, dia);

  for (const novo of entradas.get(dia) ?? []) {
    const c = { ...novo };
    if (c._primeira) {
      c.volume = c._primeira.volume;
      c.pedidos = c._primeira.pedidos;
      c.ultimaCompra = c._primeira.data === "dia" ? cobertura : c._primeira.data;
    }
    delete c._primeira;
    c.recemChegado = cobertura;
    ativos.push(c);
  }

  if (dia > 0) {
    for (const c of ativos) {
      if (c.recemChegado === cobertura) continue;
      if (c.situacao === "Inativo") continue;
      // Âncora: no dia 1 produz exatamente R$ 976,57 em 132 pedidos
      if (c === ancora && dia === 1) {
        c.volume = centavos(c.volume + 976.57);
        c.pedidos += 132;
        c.ultimaCompra = cobertura;
        continue;
      }
      if (rnd() < PROB[c.perfil]) {
        const pedidos = entre(1, 9);
        c.pedidos += pedidos;
        c.volume = centavos(c.volume + pedidos * (entre(25, 380) + rnd()));
        c.ultimaCompra = cobertura;
      }
    }
  }

  // Correção da fonte para baixo: gera pendência bloqueante. Cai num cliente
  // parado para que nenhuma compra do dia esconda a redução.
  if (dia === 22) ativos[8].volume = centavos(ativos[8].volume - 150);
  // Cliente que cancelou o plano: a fonte passa a marcá-lo como inativo
  if (dia === 16) ativos[14].situacao = "Inativo";

  const linhas = ativos.map((c) => {
    const dias = c.ultimaCompra ? diasEntre(c.ultimaCompra, cobertura) : null;
    return {
      Cliente: `${c.codigo}-${c.nome}`,
      CNPJ_CPF: c.documento,
      Vendedor: c.vendedor,
      Unidade: c.unidade,
      UF: c.uf,
      Situacao: c.situacao,
      Plano: c.plano,
      Canal: c.canal,
      Pedidos: c.pedidos,
      Volume: c.volume,
      UltimaCompra: c.ultimaCompra ? dataUTC(c.ultimaCompra) : null,
      DiasSemComprar: dias,
      Recencia: dias === null ? "" : dias <= 7 ? "Até 7 dias" : dias <= 30 ? "8 a 30 dias" : "Mais de 30 dias",
    };
  });

  const ws = XLSX.utils.json_to_sheet(linhas, { cellDates: true });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Relatorio");
  const envio = somarDias(cobertura, 1);
  writeFileSync(join(SAIDA, `relatorio-${envio}.xlsx`), XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}

console.log(`${DIAS} planilhas geradas em ${SAIDA} (${ativos.length} clientes no último dia).`);
