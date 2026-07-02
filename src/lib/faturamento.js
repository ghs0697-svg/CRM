import { google } from "googleapis";

// Faturamento calculado da própria mestre CONTROLE ALUNOS:
// receita por mês da DATA DE COMPRA (col C) somando o VALOR DO PLANO (col I),
// + quebra por plano (col G) e por categoria (col V).
const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID;
const TAB = process.env.GOOGLE_SHEETS_TAB || "CONTROLE ALUNOS";

function getCredentials() {
  if (process.env.GOOGLE_CREDENTIALS_JSON) return JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
  const private_key = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  return { client_email: process.env.GOOGLE_CLIENT_EMAIL, private_key, project_id: process.env.GOOGLE_PROJECT_ID };
}

// "758,27" / "1.591" / "R$ 1.234,56" -> número
function parseMoney(v) {
  if (v == null) return 0;
  let s = String(v).replace(/[^\d,.-]/g, "");
  if (s.includes(",")) {
    s = s.replace(/\./g, "").replace(",", "."); // BR: vírgula=decimal, pontos=milhar
  } else if (/\.\d{3}(\.|$)/.test(s)) {
    s = s.replace(/\./g, ""); // ponto de milhar sem decimal (ex "1.591" -> 1591)
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}
// Tolerante a dia/mês com 1 dígito ("1/7/2026", digitação manual na mestre) pra
// não descartar a venda em silêncio. Grupos já saem com padding (m[1]=DD, m[2]=MM).
const mDataBR = (v) => {
  const m = String(v || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? [m[0], m[1].padStart(2, "0"), m[2].padStart(2, "0"), m[3]] : null;
};
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

// mes = "YYYY-MM" filtra cards/planos/categorias pra aquele mês · "todos"/vazio = tudo
// (comportamento antigo). A série "porMes" fica sempre completa (contexto do gráfico).
export async function getFaturamentoStats(mes) {
  if (!SPREADSHEET_ID) throw new Error("GOOGLE_SHEETS_ID não definido");
  const auth = new google.auth.GoogleAuth({
    credentials: getCredentials(),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const sheets = google.sheets({ version: "v4", auth });
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `${TAB}!A2:V` });
  const rows = res.data.values || [];

  // 1º passe: vendas válidas com o mês de cada uma (pra montar a lista de meses).
  const vendas = [];
  for (const r of rows) {
    const m = mDataBR(r[2]); // col C data de compra
    const valor = parseMoney(r[8]); // col I valor do plano
    if (!m || !valor) continue;
    vendas.push({
      ym: `${m[3]}-${m[2]}`,
      valor,
      plano: String(r[6] || "—").trim() || "—", // col G
      cat: String(r[21] || "Padrão").trim() || "Padrão", // col V
    });
  }
  const meses = [...new Set(vendas.map((v) => v.ym))].sort().reverse();
  const mesSel = mes && meses.includes(mes) ? mes : "todos";

  const porMesMap = new Map(); // "YYYY-MM" -> { receita, vendas } (série completa)
  const porPlano = new Map();
  const porCategoria = new Map();
  let receitaTotal = 0, vendasTotal = 0;

  for (const v of vendas) {
    const pm = porMesMap.get(v.ym) || { receita: 0, vendas: 0 };
    pm.receita += v.valor; pm.vendas += 1; porMesMap.set(v.ym, pm);
    if (mesSel !== "todos" && v.ym !== mesSel) continue; // filtro só nos agregados
    porPlano.set(v.plano, (porPlano.get(v.plano) || 0) + v.valor);
    porCategoria.set(v.cat, (porCategoria.get(v.cat) || 0) + v.valor);
    receitaTotal += v.valor; vendasTotal += 1;
  }

  const porMes = [...porMesMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-12)
    .map(([ym, v]) => {
      const [y, mo] = ym.split("-");
      return { ym, label: `${MESES[parseInt(mo, 10) - 1]}/${y.slice(2)}`, receita: v.receita, vendas: v.vendas };
    });

  const planos = [...porPlano.entries()].map(([plano, receita]) => ({ plano, receita })).sort((a, b) => b.receita - a.receita);
  const categorias = [...porCategoria.entries()].map(([cat, receita]) => ({ cat, receita })).sort((a, b) => b.receita - a.receita);

  const ticketMedio = vendasTotal ? receitaTotal / vendasTotal : 0;
  const mesAtual = porMes.length ? porMes[porMes.length - 1] : { receita: 0, vendas: 0 };

  return { receitaTotal, vendasTotal, ticketMedio, mesAtual, porMes, planos, categorias, meses, mesSel };
}

// Vendas por DIA (pro filtro de período no painel de métricas).
// Cada linha da mestre com DATA DE COMPRA (col C) = 1 venda nesse dia.
// Renovações viram linha nova (duplicada) com sua própria data → contam como venda no dia delas.
export async function getVendasPorDia() {
  if (!SPREADSHEET_ID) throw new Error("GOOGLE_SHEETS_ID não definido");
  const auth = new google.auth.GoogleAuth({
    credentials: getCredentials(),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const sheets = google.sheets({ version: "v4", auth });
  // Lê até X pra pegar o flag de Renovação (col X "Renovação?" = "RENOVACAO").
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `${TAB}!A2:X` });
  const rows = res.data.values || [];

  const porDia = new Map(); // "YYYY-MM-DD" -> { receita, vendas, receitaRenov, vendasRenov }
  for (const r of rows) {
    const m = mDataBR(r[2]); // col C DD/MM/YYYY
    if (!m) continue;        // sem data válida = não conta
    const iso = `${m[3]}-${m[2]}-${m[1]}`;
    const valor = parseMoney(r[8]); // col I
    const isRenov = String(r[23] || "").trim().toLowerCase().includes("renov"); // col X (índice 23)
    const d = porDia.get(iso) || { receita: 0, vendas: 0, receitaRenov: 0, vendasRenov: 0 };
    d.vendas += 1;           // cada linha com data = 1 venda
    d.receita += valor;      // soma valor (0 se vazio)
    if (isRenov) { d.vendasRenov += 1; d.receitaRenov += valor; } // recorte das renovações
    porDia.set(iso, d);
  }
  const dias = [...porDia.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([data, v]) => ({ data, receita: v.receita, vendas: v.vendas, receitaRenov: v.receitaRenov, vendasRenov: v.vendasRenov }));
  return { dias, atualizado: new Date().toISOString() };
}
