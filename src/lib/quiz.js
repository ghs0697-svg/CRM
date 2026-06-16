import { google } from "googleapis";

// Lê a aba "LOG QUIZ" da planilha mestre e agrega o funil do quiz de captação.
// Colunas: A Data/Hora · B Quiz · C Etapa · D Sessão · E Fonte · F Pergunta · G Resposta
const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID;
const TAB = "LOG QUIZ";

function getCredentials() {
  if (process.env.GOOGLE_CREDENTIALS_JSON) return JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
  const private_key = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  return {
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    private_key,
    project_id: process.env.GOOGLE_PROJECT_ID,
  };
}

// "17/05/2026, 16:56:05" -> "17/05/2026"
function diaBR(dh) {
  return String(dh || "").split(",")[0].trim();
}
// DD/MM/YYYY -> YYYY-MM-DD (pra ordenar)
function brToISO(d) {
  const m = String(d).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
}

export async function getQuizStats() {
  if (!SPREADSHEET_ID) throw new Error("GOOGLE_SHEETS_ID não definido");
  const auth = new google.auth.GoogleAuth({
    credentials: getCredentials(),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const sheets = google.sheets({ version: "v4", auth });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${TAB}!A2:G`,
  });
  const rows = res.data.values || [];

  // Uma sessão = uma pessoa que entrou no quiz. Guardamos a etapa máxima que
  // ela alcançou (pro funil de drop-off), a fonte e o dia de entrada.
  const sessions = new Map();
  let totalEventos = 0;
  for (const r of rows) {
    const sess = String(r[3] || "").trim();
    if (!sess) continue;
    totalEventos++;
    const etapa = parseInt(r[2], 10) || 0;
    const fonte = String(r[4] || "").trim().toLowerCase() || "(sem fonte)";
    const dia = diaBR(r[0]);
    const s = sessions.get(sess);
    if (!s) {
      sessions.set(sess, { maxEtapa: etapa, fonte, dia });
    } else {
      if (etapa > s.maxEtapa) s.maxEtapa = etapa;
      if ((!s.fonte || s.fonte === "(sem fonte)") && fonte !== "(sem fonte)") s.fonte = fonte;
    }
  }

  const vals = [...sessions.values()];
  const totalSessions = vals.length;
  const maxEtapa = vals.reduce((m, s) => Math.max(m, s.maxEtapa), 1);

  // Funil: quantas sessões alcançaram CADA etapa (>=). % relativo a quem
  // INICIOU (etapa 1) — assim a etapa 1 = 100% e as demais mostram a retenção.
  const funilCounts = [];
  for (let e = 1; e <= maxEtapa; e++) funilCounts.push(vals.filter((s) => s.maxEtapa >= e).length);
  const iniciaram = funilCounts[0] || 0;
  const funil = funilCounts.map((n, i) => ({
    etapa: i + 1,
    sessoes: n,
    pct: iniciaram ? Math.round((n / iniciaram) * 1000) / 10 : 0,
  }));

  // Por fonte
  const fonteMap = new Map();
  for (const s of vals) fonteMap.set(s.fonte, (fonteMap.get(s.fonte) || 0) + 1);
  const porFonte = [...fonteMap.entries()]
    .map(([fonte, count]) => ({ fonte, count, pct: totalSessions ? Math.round((count / totalSessions) * 1000) / 10 : 0 }))
    .sort((a, b) => b.count - a.count);

  // Sessões novas por dia (últimos 30 dias com dado)
  const diaMap = new Map();
  for (const s of vals) { if (s.dia) diaMap.set(s.dia, (diaMap.get(s.dia) || 0) + 1); }
  const porDia = [...diaMap.entries()]
    .map(([dia, count]) => ({ dia, count }))
    .sort((a, b) => brToISO(a.dia).localeCompare(brToISO(b.dia)))
    .slice(-30);

  const concluiram = funilCounts.length ? funilCounts[funilCounts.length - 1] : 0;
  const taxaConclusao = iniciaram ? Math.round((concluiram / iniciaram) * 1000) / 10 : 0;

  return { totalSessions, totalEventos, maxEtapa, iniciaram, concluiram, taxaConclusao, funil, porFonte, porDia };
}
