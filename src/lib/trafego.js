import { google } from "googleapis";

// Tráfego pago (Meta Ads) — planilha externa que um robô atualiza sozinho.
// Aba SNAPSHOT: 1 foto por atualização (timestamp). Colunas:
//   0 timestamp · 1 produto · 2 campanha · 3 criativo_id · 4 ad_name
//   7 gasto · 8 impressoes · 11 cliques_link · 15 vendas_meta · 16 receita_meta
//   17 cpa · 18 roas_meta · 21 veredito
// Aba DIARIO: data · produto · gasto_dia · vendas_meta · receita_meta · roas_meta ...
const TRAFEGO_SHEET_ID = process.env.TRAFEGO_SHEET_ID || "1zZuyRjVI-lKeawcdIZeGFmtaiOhGCn7zlRsC3-tOtTs";

function getCredentials() {
  if (process.env.GOOGLE_CREDENTIALS_JSON) return JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
  const private_key = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  return { client_email: process.env.GOOGLE_CLIENT_EMAIL, private_key, project_id: process.env.GOOGLE_PROJECT_ID };
}

// "1.213,50" / "682" / "1,45" -> número (BR: vírgula=decimal, ponto=milhar)
function num(v) {
  if (v == null) return 0;
  let s = String(v).replace(/[^\d,.-]/g, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/\.\d{3}(\.|$)/.test(s)) s = s.replace(/\./g, "");
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}
const int = (v) => parseInt(String(v ?? "").replace(/[^\d-]/g, ""), 10) || 0;
const cap = (s) => { const t = String(s || "").trim(); return t ? t.charAt(0).toUpperCase() + t.slice(1) : t; };

export async function getTrafegoStats() {
  const auth = new google.auth.GoogleAuth({
    credentials: getCredentials(),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const sheets = google.sheets({ version: "v4", auth });

  const res = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: TRAFEGO_SHEET_ID,
    ranges: ["SNAPSHOT!A2:V", "DIARIO!A2:H"],
  });
  const snap = res.data.valueRanges?.[0]?.values || [];
  const diario = res.data.valueRanges?.[1]?.values || [];

  // último snapshot (timestamp mais recente)
  let ult = "";
  for (const r of snap) { const t = String(r[0] || ""); if (t > ult) ult = t; }
  const rows = snap.filter((r) => String(r[0] || "") === ult);

  // agrega por produto -> criativo (ad_name)
  const produtos = new Map(); // produto -> { criativos:Map, total }
  for (const r of rows) {
    const prod = String(r[1] || "—").trim() || "—";
    const nome = cap(r[4] || "?");
    const key = nome.toLowerCase();
    const P = produtos.get(prod) || { criativos: new Map(), total: { cliques: 0, vendas: 0, receita: 0, gasto: 0, imp: 0 } };
    const c = P.criativos.get(key) || { nome, cliques: 0, vendas: 0, receita: 0, gasto: 0, imp: 0 };
    c.cliques += int(r[11]); c.vendas += int(r[15]); c.receita += num(r[16]); c.gasto += num(r[7]); c.imp += int(r[8]);
    P.criativos.set(key, c);
    P.total.cliques += int(r[11]); P.total.vendas += int(r[15]); P.total.receita += num(r[16]); P.total.gasto += num(r[7]); P.total.imp += int(r[8]);
    produtos.set(prod, P);
  }

  // série diária por produto
  const diasPorProd = new Map();
  for (const r of diario) {
    const data = String(r[0] || "").trim();
    const prod = String(r[1] || "—").trim() || "—";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) continue;
    const arr = diasPorProd.get(prod) || [];
    arr.push({ data, gasto: num(r[2]), vendas: int(r[3]), receita: num(r[4]), roas: num(r[5]) });
    diasPorProd.set(prod, arr);
  }

  const enrich = (c) => ({
    ...c,
    roas: c.gasto ? c.receita / c.gasto : 0,
    cpa: c.vendas ? c.gasto / c.vendas : 0,
    cpc: c.cliques ? c.gasto / c.cliques : 0,
    ctr: c.imp ? (c.cliques / c.imp) * 100 : 0,
    conv: c.cliques ? (c.vendas / c.cliques) * 100 : 0,
  });

  const out = [...produtos.entries()].map(([nome, P]) => {
    const criativos = [...P.criativos.values()].map(enrich).sort((a, b) => b.vendas - a.vendas || b.cliques - a.cliques);
    const total = enrich(P.total);
    const dias = (diasPorProd.get(nome) || []).sort((a, b) => a.data.localeCompare(b.data)).slice(-30).reverse();
    // vencedores
    const ativos = criativos.filter((c) => c.cliques > 0);
    const topVendas = ativos.slice().sort((a, b) => b.vendas - a.vendas)[0]?.nome || null;
    const escalaveis = ativos.filter((c) => c.vendas >= 3);
    const topRoas = (escalaveis.length ? escalaveis : ativos).slice().sort((a, b) => b.roas - a.roas)[0]?.nome || null;
    const queimaGrana = ativos.slice().sort((a, b) => b.cliques - a.cliques).find((c) => c.roas < 1 && c.cliques >= 50)?.nome || null;
    return { nome, criativos, total, dias, topVendas, topRoas, queimaGrana };
  }).sort((a, b) => b.total.receita - a.total.receita);

  return { produtos: out, atualizado: ult || null };
}
