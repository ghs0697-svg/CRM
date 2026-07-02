import { google } from "googleapis";

// Funil de leads do ManyChat — planilha "Controle Leads ManyChat".
// Aba PAINEL (diário, já agregado): linha 4 é o cabeçalho, dados a partir da 5.
//   A Data · B Dia · C Boas Vindas · D FRIO · E MORNO · F QUENTE · G LINK · ...
const LEADS_SHEET_ID = process.env.LEADS_SHEET_ID || "1PzUnZx6fNv-by0H1A9QZzDpp5jJJ4hOmp2LOuuLQrXE";

function getCredentials() {
  if (process.env.GOOGLE_CREDENTIALS_JSON) return JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
  const private_key = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  return {
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    private_key,
    project_id: process.env.GOOGLE_PROJECT_ID,
  };
}

const numInt = (v) => parseInt(String(v ?? "").replace(/[^\d-]/g, ""), 10) || 0;
// Tolerante a dia/mês com 1 dígito ("1/7/2026") pra não descartar linha em silêncio.
const isDataBR = (v) => /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(String(v || "").trim());
const brToISO = (d) => {
  const m = String(d).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : "";
};
// "Hoje" no fuso de São Paulo (a Vercel roda em UTC: das 21h à meia-noite BRT o
// toISOString() já virou o dia seguinte e deixava passar a linha zerada de amanhã).
// Espelha o todayISO() do follow-sumidos.js.
const todayISO = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

export async function getFunilStats(mes) {
  const auth = new google.auth.GoogleAuth({
    credentials: getCredentials(),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const sheets = google.sheets({ version: "v4", auth });

  const res = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: LEADS_SHEET_ID,
    ranges: ["PAINEL!A5:G"],
  });
  const painel = res.data.valueRanges?.[0]?.values || [];

  const dias = [];
  for (const r of painel) {
    if (!isDataBR(r[0])) continue;
    dias.push({
      data: String(r[0]).trim(),
      dia: String(r[1] || "").trim(),
      boasVindas: numInt(r[2]),
      frio: numInt(r[3]),
      morno: numInt(r[4]),
      quente: numInt(r[5]),
      link: numInt(r[6]),
    });
  }
  dias.sort((a, b) => brToISO(a.data).localeCompare(brToISO(b.data)));
  // Remove dias FUTUROS (a planilha pré-preenche datas adiante com zeros).
  const hojeISO = todayISO();
  const diasReais = dias.filter((d) => { const iso = brToISO(d.data); return iso && iso <= hojeISO; });

  // Filtro de mês. meses = YYYY-MM disponíveis (mais recente primeiro).
  // mes = "YYYY-MM" filtra aquele mês · mes = "todos" agrega tudo · sem mes = default no mês mais recente.
  const meses = [...new Set(diasReais.map((d) => brToISO(d.data).slice(0, 7)).filter(Boolean))].sort().reverse();
  let mesSel;
  if (mes === "todos") mesSel = "todos";
  else if (mes && meses.includes(mes)) mesSel = mes;
  else mesSel = meses[0] || "todos";
  const diasUsados = mesSel === "todos" ? diasReais : diasReais.filter((d) => brToISO(d.data).slice(0, 7) === mesSel);

  const totals = diasUsados.reduce(
    (t, d) => ({
      boasVindas: t.boasVindas + d.boasVindas,
      frio: t.frio + d.frio,
      morno: t.morno + d.morno,
      quente: t.quente + d.quente,
      link: t.link + d.link,
    }),
    { boasVindas: 0, frio: 0, morno: 0, quente: 0, link: 0 }
  );
  const pct = (n) => (totals.boasVindas ? Math.round((n / totals.boasVindas) * 1000) / 10 : 0);
  totals.pctMorno = pct(totals.morno);
  totals.pctQuente = pct(totals.quente);
  totals.pctLink = pct(totals.link);

  // Linktree (cliques por link) — aba LINKTREE da MESMA sheet, escrita pelo coletor do CRM
  // (~/webfit-mcp/linktree/coletor-linktree.mjs, cron no Mac). Leitura separada e guardada:
  // se a aba ainda não existe, o /funil não quebra.
  let linktree = [];
  let linktreeAtualizado = null;
  try {
    const lt = await sheets.spreadsheets.values.get({ spreadsheetId: LEADS_SHEET_ID, range: "LINKTREE!A2:I" });
    for (const r of (lt.data.values || [])) {
      if (!r[1]) continue; // sem tr_ee_id = linha vazia
      linktree.push({
        id: String(r[1]).trim(),
        label: String(r[2] || "").trim(),
        tipo: String(r[3] || "").trim(),
        destino: String(r[4] || "").trim(),
        c24: numInt(r[5]), c7: numInt(r[6]), c28: numInt(r[7]), total: numInt(r[8]),
      });
      if (!linktreeAtualizado && r[0]) linktreeAtualizado = String(r[0]).trim();
    }
    linktree.sort((a, b) => b.c7 - a.c7 || b.total - a.total);
  } catch { linktree = []; }

  const recent = mesSel === "todos" ? diasUsados.slice(-30).reverse() : [...diasUsados].reverse();
  return { totals, recent, linktree, linktreeAtualizado, meses, mesSel };
}
