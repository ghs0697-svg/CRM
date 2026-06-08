// Lê a planilha "PAINEL DE LEADS" (REGISTRO) e calcula stats do mês corrente.
// Cada linha é 1 lead com colunas:
//   A Data  | B Boas vindas | C FRIO | D MORNO | E QUENTE | F LINK
// Boolean "TRUE" / "FALSE" / vazio.

import { google } from "googleapis";

const LEADS_SHEET_ID =
  process.env.LEADS_SHEET_ID ||
  "1PzUnZx6fNv-by0H1A9QZzDpp5jJJ4hOmp2LOuuLQrXE";
const TAB = "REGISTRO";

function getCredentials() {
  if (process.env.GOOGLE_CREDENTIALS_JSON) return JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
  const private_key = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  return {
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    private_key,
    project_id: process.env.GOOGLE_PROJECT_ID,
  };
}

let cachedClient = null;
async function getSheetsClient() {
  if (cachedClient) return cachedClient;
  const auth = new google.auth.GoogleAuth({
    credentials: getCredentials(),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  cachedClient = google.sheets({ version: "v4", auth });
  return cachedClient;
}

function isTrue(v) {
  if (v === true) return true;
  const s = String(v ?? "").trim().toUpperCase();
  return s === "TRUE" || s === "VERDADEIRO" || s === "1" || s === "SIM";
}

/**
 * Retorna stats agregados do mês informado (ou mês corrente).
 * @param {{ monthKey?: string }} opts — monthKey no formato "MM/YYYY"
 */
export async function getLeadsStats(opts = {}) {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: LEADS_SHEET_ID,
    range: `${TAB}!A2:F10000`,
  });
  const rows = res.data.values || [];

  let monthKey = opts.monthKey;
  if (!monthKey) {
    const d = new Date();
    monthKey = `${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  }

  let totalLeads = 0;
  let boasVindas = 0;
  let frio = 0;
  let morno = 0;
  let quente = 0;
  let link = 0;

  for (const row of rows) {
    const data = row[0] || "";
    const m = data.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (!m) continue;
    const rowMonthKey = `${m[2].padStart(2, "0")}/${m[3]}`;
    if (rowMonthKey !== monthKey) continue;

    totalLeads++;
    if (isTrue(row[1])) boasVindas++;
    if (isTrue(row[2])) frio++;
    if (isTrue(row[3])) morno++;
    if (isTrue(row[4])) quente++;
    if (isTrue(row[5])) link++;
  }

  return { monthKey, totalLeads, boasVindas, frio, morno, quente, link };
}
