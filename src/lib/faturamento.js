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
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", "."); // BR: ponto=milhar, vírgula=decimal
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}
const mDataBR = (v) => String(v || "").trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export async function getFaturamentoStats() {
  if (!SPREADSHEET_ID) throw new Error("GOOGLE_SHEETS_ID não definido");
  const auth = new google.auth.GoogleAuth({
    credentials: getCredentials(),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const sheets = google.sheets({ version: "v4", auth });
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `${TAB}!A2:V` });
  const rows = res.data.values || [];

  const porMesMap = new Map(); // "YYYY-MM" -> { receita, vendas }
  const porPlano = new Map();
  const porCategoria = new Map();
  let receitaTotal = 0, vendasTotal = 0;

  for (const r of rows) {
    const m = mDataBR(r[2]); // col C data de compra
    const valor = parseMoney(r[8]); // col I valor do plano
    if (!m || !valor) continue;
    const ym = `${m[3]}-${m[2]}`;
    const plano = String(r[6] || "—").trim() || "—"; // col G
    const cat = String(r[21] || "Padrão").trim() || "Padrão"; // col V

    const pm = porMesMap.get(ym) || { receita: 0, vendas: 0 };
    pm.receita += valor; pm.vendas += 1; porMesMap.set(ym, pm);
    porPlano.set(plano, (porPlano.get(plano) || 0) + valor);
    porCategoria.set(cat, (porCategoria.get(cat) || 0) + valor);
    receitaTotal += valor; vendasTotal += 1;
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

  return { receitaTotal, vendasTotal, ticketMedio, mesAtual, porMes, planos, categorias };
}
