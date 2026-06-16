import { google } from "googleapis";

// Engajamento de treino — lê a aba LOGS da mestre (1 linha = 1 treino concluído
// no app). Colunas: A Timestamp · B Aluno · C SheetId · D Data Treino (YYYY-MM-DD)
// · E Dia · F Exercicios · G Sequencia Atual · H Recorde · I Total Dias
// · J Compartilhou · K Frequencia (alvo Nx/semana).
const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID;
const TAB = "LOGS";

function getCredentials() {
  if (process.env.GOOGLE_CREDENTIALS_JSON) return JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
  const private_key = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  return { client_email: process.env.GOOGLE_CLIENT_EMAIL, private_key, project_id: process.env.GOOGLE_PROJECT_ID };
}

const num = (v) => parseInt(String(v ?? "").replace(/[^\d]/g, ""), 10) || 0;
// "2026-06-15" -> Date (meia-noite). Retorna null se inválida/futura.
function parseISO(s) {
  const m = String(s || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00`);
}

export async function getEngajamentoStats() {
  if (!SPREADSHEET_ID) throw new Error("GOOGLE_SHEETS_ID não definido");
  const auth = new google.auth.GoogleAuth({
    credentials: getCredentials(),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const sheets = google.sheets({ version: "v4", auth });
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `${TAB}!A2:K` });
  const rows = res.data.values || [];

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const diasAtras = (d) => Math.floor((hoje - d) / 86400000);

  // Estado por aluno (chave = SheetId; nome só pra exibir). Guarda o registro
  // mais RECENTE (maior data de treino) pra ler streak/freq atuais.
  const alunos = new Map();
  const treinosPorDia = new Map();
  let treinosTotal = 0;

  for (const r of rows) {
    const sid = String(r[2] || "").trim();
    const d = parseISO(r[3]);
    if (!sid || !d || diasAtras(d) < 0) continue; // ignora sem id / data inválida / futura
    treinosTotal++;
    const iso = r[3].trim();
    treinosPorDia.set(iso, (treinosPorDia.get(iso) || 0) + 1);

    const a = alunos.get(sid);
    const rec = {
      nome: String(r[1] || "").trim() || "—",
      lastData: d,
      streak: num(r[6]),
      recorde: num(r[7]),
      totalDias: num(r[8]),
      freq: num(r[10]),
    };
    if (!a) {
      alunos.set(sid, rec);
    } else {
      if (d >= a.lastData) { a.lastData = d; a.streak = rec.streak; a.freq = rec.freq; if (rec.nome !== "—") a.nome = rec.nome; }
      a.recorde = Math.max(a.recorde, rec.recorde);
      a.totalDias = Math.max(a.totalDias, rec.totalDias);
    }
  }

  const lista = [...alunos.entries()].map(([sid, a]) => ({ sid, ...a, diasSemTreinar: diasAtras(a.lastData) }));
  const totalAlunos = lista.length;
  const ativos7 = lista.filter((a) => a.diasSemTreinar <= 7).length;
  const ativos30 = lista.filter((a) => a.diasSemTreinar <= 30).length;
  const freqsAtivas = lista.filter((a) => a.freq > 0 && a.diasSemTreinar <= 30).map((a) => a.freq);
  const freqMedia = freqsAtivas.length ? Math.round((freqsAtivas.reduce((s, x) => s + x, 0) / freqsAtivas.length) * 10) / 10 : 0;

  // Em risco: treinavam mas pararam há 10–45 dias (recuperável). Mais recente primeiro.
  const emRisco = lista
    .filter((a) => a.diasSemTreinar >= 10 && a.diasSemTreinar <= 45 && a.totalDias >= 2)
    .sort((a, b) => a.diasSemTreinar - b.diasSemTreinar)
    .slice(0, 25);

  // Ranking de consistência (mais dias treinados).
  const ranking = [...lista].sort((a, b) => b.totalDias - a.totalDias).slice(0, 20);

  // Treinos por dia (últimos 30 dias com dado).
  const porDia = [...treinosPorDia.entries()]
    .map(([iso, count]) => ({ iso, count }))
    .sort((a, b) => a.iso.localeCompare(b.iso))
    .slice(-30)
    .map((x) => ({ dia: x.iso.split("-").reverse().slice(0, 2).join("/"), count: x.count }));

  // treinos registrados nos últimos 30 dias
  const treinos30 = [...treinosPorDia.entries()]
    .filter(([iso]) => { const d = parseISO(iso); return d && diasAtras(d) <= 30; })
    .reduce((s, [, c]) => s + c, 0);

  return { totalAlunos, ativos7, ativos30, freqMedia, treinosTotal, treinos30, emRisco, ranking, porDia };
}
