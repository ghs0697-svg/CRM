import { google } from "googleapis";

// Funil por etapa do QUIZ do Peitão de Pombo, lido da MESMA aba "LOG QUIZ" da mestre
// (quiz=peitao). O quiz substituiu a LP e virou a raiz de peitaodepombo.com.br em
// 2026-07-14 (Sala #696). Colunas: A Data/Hora · B Quiz · C Etapa(step) · D Sessão(sid)
// · E Fonte · F Pergunta · G Resposta. O índice n0..n20 do #696 vira ordem canônica
// pelos NOMES dos steps (o track.js não grava o n numa coluna).
//
// CORTE 14/07: antes do go-live, quiz=peitao só tinha step=pageview (visitas da LP
// antiga). Sem corte, o topo do funil fica inflado por visita histórica.
const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID;
const TAB = "LOG QUIZ";
const CUTOFF = Date.UTC(2026, 6, 14); // 14/07/2026 00:00 UTC (mês 6 = julho)

// Ordem canônica dos 21 passos (Sala #696): n0 pageview ... n20 checkout_click.
const STEP_ORDER = [
  "pageview", "idade", "estado", "t_autoridade", "tempo_treino", "freq", "desafio",
  "t_historia", "execucao", "cansa", "pico", "regiao", "conhece", "vsl1", "pos_vsl",
  "tempo_sessao", "t_prova", "proc", "result", "oferta", "checkout_click",
];
const STEP_IDX = new Map(STEP_ORDER.map((s, i) => [s, i]));
// Rótulos amigáveis (o GH lê isso no painel).
const STEP_LABEL = {
  pageview: "Entrou na página", idade: "Idade", estado: "Estado",
  t_autoridade: "Texto de autoridade", tempo_treino: "Tempo de treino", freq: "Frequência",
  desafio: "Maior desafio", t_historia: "Texto de história", execucao: "Execução",
  cansa: "O que cansa", pico: "Pico de treino", regiao: "Região", conhece: "Já conhece o método",
  vsl1: "VSL 1 (mecanismo)", pos_vsl: "Depois da VSL 1", tempo_sessao: "Tempo por sessão",
  t_prova: "Texto de prova", proc: "Procrastinação", result: "Resultado (diagnóstico)",
  oferta: "Oferta (VSL 2 / preço)", checkout_click: "Clicou em comprar",
};
const IDX_PAGEVIEW = 0, IDX_COMECOU = 1, IDX_OFERTA = STEP_IDX.get("oferta"), IDX_COMPROU = STEP_IDX.get("checkout_click");

function getCredentials() {
  if (process.env.GOOGLE_CREDENTIALS_JSON) return JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
  const private_key = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  return { client_email: process.env.GOOGLE_CLIENT_EMAIL, private_key, project_id: process.env.GOOGLE_PROJECT_ID };
}
const round1 = (x) => Math.round(x * 10) / 10;

// col A mista (texto "DD/MM/YYYY..." OU serial do Sheets) → timestamp UTC do dia (ou null).
function serialToMs(num) { const ms = Math.round((num - 25569) * 86400000); return Number.isFinite(ms) ? ms : null; }
function cellToTs(cell) {
  if (cell == null || cell === "") return null;
  const s = String(cell).trim();
  const m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return Date.UTC(+m[3], +m[2] - 1, +m[1]);
  const num = parseFloat(s.replace(",", "."));
  if (!isNaN(num) && num > 30000 && num < 90000) return serialToMs(num);
  return null;
}

export async function getPeitaoQuizStats() {
  if (!SPREADSHEET_ID) throw new Error("GOOGLE_SHEETS_ID não definido");
  const auth = new google.auth.GoogleAuth({ credentials: getCredentials(), scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"] });
  const sheets = google.sheets({ version: "v4", auth });
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `${TAB}!A2:G` });
  const rows = res.data.values || [];

  // Por sessão (sid): maior índice de step alcançado + 1ª fonte. Só quiz=peitao, pós-corte.
  const sessions = new Map();
  let totalEventos = 0, stepsForaDoQuiz = 0;
  for (const r of rows) {
    if (String(r[1] || "").trim().toLowerCase() !== "peitao") continue;
    const ts = cellToTs(r[0]);
    if (ts !== null && ts < CUTOFF) continue; // corte 14/07 (null = mantém, raríssimo)
    const sid = String(r[3] || "").trim();
    if (!sid) continue;
    totalEventos++;
    const step = String(r[2] || "").trim().toLowerCase();
    const idx = STEP_IDX.has(step) ? STEP_IDX.get(step) : -1;
    if (step && idx === -1) { stepsForaDoQuiz++; continue; }
    const fonte = String(r[4] || "").trim().toLowerCase() || "(sem fonte)";
    let s = sessions.get(sid);
    if (!s) { s = { maxIdx: -1, fonte }; sessions.set(sid, s); }
    if (idx > s.maxIdx) s.maxIdx = idx;
    if ((!s.fonte || s.fonte === "(sem fonte)") && fonte !== "(sem fonte)") s.fonte = fonte;
  }

  const all = [...sessions.values()];
  const visitas = all.filter((s) => s.maxIdx >= IDX_PAGEVIEW).length;
  const comecaram = all.filter((s) => s.maxIdx >= IDX_COMECOU).length;
  const chegaramOferta = all.filter((s) => s.maxIdx >= IDX_OFERTA).length;
  const compraram = all.filter((s) => s.maxIdx >= IDX_COMPROU).length;

  // Funil: cada etapa = nº de sessões que a ALCANÇARAM (maxIdx >= n). Retenção = % da
  // etapa anterior (é aí que se vê ONDE abandona: menor retenção = maior queda).
  const funil = STEP_ORDER.map((step, i) => {
    const sessoes = all.filter((s) => s.maxIdx >= i).length;
    return { n: i, key: step, label: STEP_LABEL[step] || step, sessoes,
      pctVisitas: visitas ? round1((sessoes / visitas) * 100) : 0,
      pctComecou: comecaram ? round1((sessoes / comecaram) * 100) : 0 };
  });
  for (let i = 0; i < funil.length; i++) {
    const prev = i > 0 ? funil[i - 1].sessoes : funil[i].sessoes;
    funil[i].retencao = prev ? round1((funil[i].sessoes / prev) * 100) : 0;
    funil[i].queda = i > 0 ? Math.max(0, prev - funil[i].sessoes) : 0;
  }
  // Maior queda (só entre etapas com base > 0), pra destacar "onde perde mais gente".
  let maiorQueda = null;
  for (let i = 1; i < funil.length; i++) {
    if (funil[i - 1].sessoes <= 0) continue;
    if (!maiorQueda || funil[i].retencao < maiorQueda.retencao) maiorQueda = { ...funil[i], de: funil[i - 1].label };
  }

  // Por fonte de quem começou (>= idade).
  const fonteMap = new Map();
  for (const s of all) if (s.maxIdx >= IDX_COMECOU) fonteMap.set(s.fonte, (fonteMap.get(s.fonte) || 0) + 1);
  const porFonte = [...fonteMap.entries()].map(([fonte, count]) => ({ fonte, count, pct: comecaram ? round1((count / comecaram) * 100) : 0 })).sort((a, b) => b.count - a.count);

  return {
    visitas, comecaram, chegaramOferta, compraram,
    taxaVisitaComecou: visitas ? round1((comecaram / visitas) * 100) : 0,
    taxaComecouComprou: comecaram ? round1((compraram / comecaram) * 100) : 0,
    funil, maiorQueda, porFonte, totalEventos, stepsForaDoQuiz,
  };
}
