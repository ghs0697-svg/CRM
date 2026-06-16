import { google } from "googleapis";

// Funil de leads do ManyChat — planilha "Controle Leads ManyChat".
// Aba PAINEL (diário, já agregado): linha 4 é o cabeçalho, dados a partir da 5.
//   A Data · B Dia · C Boas Vindas · D FRIO · E MORNO · F QUENTE · G LINK · ...
// Aba "REGISTRO BITLY": A Data · B Fonte · C Cliques
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
const isDataBR = (v) => /^\d{2}\/\d{2}\/\d{4}$/.test(String(v || "").trim());
const brToISO = (d) => {
  const m = String(d).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
};

export async function getFunilStats() {
  const auth = new google.auth.GoogleAuth({
    credentials: getCredentials(),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const sheets = google.sheets({ version: "v4", auth });

  const res = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: LEADS_SHEET_ID,
    ranges: ["PAINEL!A5:G", "REGISTRO BITLY!A2:C"],
  });
  const painel = res.data.valueRanges?.[0]?.values || [];
  const bitlyRows = res.data.valueRanges?.[1]?.values || [];

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
  const hojeISO = new Date().toISOString().slice(0, 10);
  const diasReais = dias.filter((d) => { const iso = brToISO(d.data); return iso && iso <= hojeISO; });

  const totals = diasReais.reduce(
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

  // Bitly: cliques por fonte (BIO / STORIES / DM / ...)
  const fonteMap = new Map();
  for (const r of bitlyRows) {
    const fonte = String(r[1] || "").trim().toUpperCase();
    if (!fonte) continue;
    fonteMap.set(fonte, (fonteMap.get(fonte) || 0) + numInt(r[2]));
  }
  const bitly = [...fonteMap.entries()]
    .map(([fonte, cliques]) => ({ fonte, cliques }))
    .sort((a, b) => b.cliques - a.cliques);
  const bitlyTotal = bitly.reduce((s, x) => s + x.cliques, 0);

  return { totals, recent: diasReais.slice(-30).reverse(), bitly, bitlyTotal };
}
