import { google } from "googleapis";

// Funil do quiz de captação ATUAL do Método GH, lido da aba "LOG QUIZ" da mestre.
// Colunas: A Data/Hora · B Quiz · C Etapa(step) · D Sessão(sid) · E Fonte · F Pergunta · G Resposta.
//
// Dois cuidados (alinhados com 02-produtos/painel-funil/api/read.js, a referência validada):
//  1) FILTRO: só linhas do quiz atual → col B (lowercase) === "metodogh".
//  2) CORTE 26/05/2026: antes disso o quiz tinha outras perguntas (a "budget" saiu).
//     Linhas anteriores são de um quiz que não existe mais → ignorar. A col A vem em
//     formato MISTO (texto "DD/MM/YYYY..." E número de série do Sheets) → normalizar
//     antes de comparar.
//  3) FUNIL pelos STEPS REAIS do quiz de hoje (não "todo step que aparece"). Ordem real:
//     1,2,3,4,5,diag,6,7,loading,result,wa. Mostra as 7 perguntas + conversão (clique no
//     WhatsApp). Steps fora dessa lista (8,9,10 do quiz antigo) são descartados sempre.
const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID;
const TAB = "LOG QUIZ";

// 26/05/2026 00:00 UTC (mês 4 = maio).
const CUTOFF_MGH = Date.UTC(2026, 4, 26);

// Ordem canônica dos passos do quiz atual. wa = clique no WhatsApp (conversão externa).
const STEP_ORDER = ["1", "2", "3", "4", "5", "diag", "6", "7", "loading", "result", "wa"];
const STEP_IDX = new Map(STEP_ORDER.map((s, i) => [s, i]));
// "Concluiu o quiz" = chegou na tela final antes do WhatsApp. No quiz ATUAL o
// último passo logado é "loading" (a tela "result" só existia no quiz antigo);
// usar loading pega quem terminou hoje E, como result>loading, pega result também
// se algum dia voltar a ser logado.
const IDX_DONE = STEP_IDX.get("loading");
const IDX_WA = STEP_IDX.get("wa"); // conversão

// Estágios exibidos no funil (rótulo + índice na ordem canônica). diag/loading
// ficam de fora da exibição mas contam na ordenação (passar por 6/7 implica diag).
const STAGES = [
  { key: "q1", label: "Pergunta 1", at: STEP_IDX.get("1") },
  { key: "q2", label: "Pergunta 2", at: STEP_IDX.get("2") },
  { key: "q3", label: "Pergunta 3", at: STEP_IDX.get("3") },
  { key: "q4", label: "Pergunta 4", at: STEP_IDX.get("4") },
  { key: "q5", label: "Pergunta 5", at: STEP_IDX.get("5") },
  { key: "q6", label: "Pergunta 6", at: STEP_IDX.get("6") },
  { key: "q7", label: "Pergunta 7", at: STEP_IDX.get("7") },
  { key: "fim", label: "Concluiu o quiz", at: IDX_DONE },
];

function getCredentials() {
  if (process.env.GOOGLE_CREDENTIALS_JSON) return JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
  const private_key = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  return {
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    private_key,
    project_id: process.env.GOOGLE_PROJECT_ID,
  };
}

const round1 = (x) => Math.round(x * 10) / 10;

// Serial do Sheets (dias desde 1899-12-30; 25569 = 1970-01-01) → ms epoch.
function serialToMs(num) {
  const ms = Math.round((num - 25569) * 86400000);
  return Number.isFinite(ms) ? ms : null;
}
// col A mista (texto "DD/MM/YYYY..." OU serial) → timestamp UTC do DIA (ou null).
function cellToTs(cell) {
  if (cell == null || cell === "") return null;
  const s = String(cell).trim();
  const m = s.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return Date.UTC(+m[3], +m[2] - 1, +m[1]);
  const num = parseFloat(s.replace(",", "."));
  if (!isNaN(num) && num > 30000 && num < 90000) return serialToMs(num);
  return null;
}
// col A mista → "DD/MM/YYYY" pro agrupamento por dia.
function cellToDia(cell) {
  const s = String(cell || "").trim();
  const m = s.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return `${m[1]}/${m[2]}/${m[3]}`;
  const num = parseFloat(s.replace(",", "."));
  if (!isNaN(num) && num > 30000 && num < 90000) {
    const ms = serialToMs(num);
    if (ms == null) return "";
    const d = new Date(ms);
    const p = (n) => String(n).padStart(2, "0");
    return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
  }
  return "";
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

  // Por sessão (sid): maior índice de step REAL alcançado (wa fora do maxIdx),
  // se clicou no WhatsApp, fonte e dia. Só quiz=metodogh e pós-corte 26/05.
  const sessions = new Map();
  let totalEventos = 0;
  let descartadosVelho = 0; // eventos de step do quiz antigo (8/9/10...) — só pra log
  for (const r of rows) {
    if (String(r[1] || "").trim().toLowerCase() !== "metodogh") continue;
    const ts = cellToTs(r[0]);
    if (ts !== null && ts < CUTOFF_MGH) continue; // corte 26/05 (null = mantém, raríssimo)
    const sid = String(r[3] || "").trim();
    if (!sid) continue;
    totalEventos++;

    const step = String(r[2] || "").trim().toLowerCase();
    const idx = STEP_IDX.has(step) ? STEP_IDX.get(step) : -1; // -1 = step fora do quiz atual
    if (step && idx === -1) descartadosVelho++;
    const fonte = String(r[4] || "").trim().toLowerCase() || "(sem fonte)";
    const dia = cellToDia(r[0]);

    let s = sessions.get(sid);
    if (!s) { s = { maxIdx: -1, wa: false, fonte, dia }; sessions.set(sid, s); }
    // wa NÃO entra no maxIdx: a página-ponte /go também loga step=wa em
    // quiz=metodogh; se contasse, um hit de wa solto inflaria o funil inteiro.
    if (idx >= 0 && idx < IDX_WA && idx > s.maxIdx) s.maxIdx = idx;
    if (idx === IDX_WA) s.wa = true;
    if ((!s.fonte || s.fonte === "(sem fonte)") && fonte !== "(sem fonte)") s.fonte = fonte;
    if (!s.dia && dia) s.dia = dia;
  }

  const vals = [...sessions.values()];
  const totalSessions = vals.length; // todos os sids que tocaram o quiz atual (inclui só-wa/ruído)
  // "Reais" = entraram no quiz de fato (>=1 step real). Sessão só-wa (da /go) ou só
  // com step do quiz antigo NÃO conta como início.
  const reais = vals.filter((s) => s.maxIdx >= 0);
  const iniciaram = reais.length;

  // Funil: quantas sessões alcançaram CADA estágio (maxIdx >= at). % vs quem iniciou.
  const funil = STAGES.map((st) => {
    const n = reais.filter((s) => s.maxIdx >= st.at).length;
    return { key: st.key, label: st.label, sessoes: n, pct: iniciaram ? round1((n / iniciaram) * 100) : 0 };
  });
  // Conversão WhatsApp: quem fez o quiz (>=1 step real) E clicou no wa — exclui o
  // wa inflado da /go (sessões só-wa não entram em `reais`).
  const waCount = reais.filter((s) => s.wa).length;
  funil.push({ key: "wa", label: "Clicou no WhatsApp", sessoes: waCount, pct: iniciaram ? round1((waCount / iniciaram) * 100) : 0 });

  const concluiram = reais.filter((s) => s.maxIdx >= IDX_DONE).length;
  const taxaConclusao = iniciaram ? round1((concluiram / iniciaram) * 100) : 0;
  const conversaoWa = iniciaram ? round1((waCount / iniciaram) * 100) : 0;

  // Por fonte (só sessões reais do quiz atual)
  const fonteMap = new Map();
  for (const s of reais) fonteMap.set(s.fonte, (fonteMap.get(s.fonte) || 0) + 1);
  const porFonte = [...fonteMap.entries()]
    .map(([fonte, count]) => ({ fonte, count, pct: iniciaram ? round1((count / iniciaram) * 100) : 0 }))
    .sort((a, b) => b.count - a.count);

  // Sessões novas por dia (últimos 30 com dado)
  const diaMap = new Map();
  for (const s of reais) { if (s.dia) diaMap.set(s.dia, (diaMap.get(s.dia) || 0) + 1); }
  const porDia = [...diaMap.entries()]
    .map(([dia, count]) => ({ dia, count }))
    .sort((a, b) => brToISO(a.dia).localeCompare(brToISO(b.dia)))
    .slice(-30);

  return {
    totalSessions, totalEventos, descartadosVelho,
    iniciaram, concluiram, taxaConclusao, waCount, conversaoWa,
    funil, porFonte, porDia,
  };
}
