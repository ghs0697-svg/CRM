import { google } from "googleapis";

// Funil por etapa do QUIZ do Peitão de Pombo, lido da MESMA aba "LOG QUIZ" da mestre
// (quiz=peitao). O quiz substituiu a LP e virou a raiz de peitaodepombo.com.br em
// 2026-07-14 (Sala #696). Colunas LOG QUIZ: A Data/Hora · B Quiz · C Etapa(step) ·
// D Sessão(sid) · E Fonte · F Pergunta · G Resposta. O índice n0..n20 (#696) vira
// ordem canônica pelos NOMES dos steps (o track.js não grava o n numa coluna).
//
// VERSÕES: o GH edita o quiz ao longo do tempo (reordena/renomeia/tira etapas). Pra
// não misturar versões, o funil filtra pela JANELA da versão escolhida. As versões
// vivem na aba QUIZ_VERSOES (quiz | versao | inicio | obs); a janela de cada uma vai
// do seu "inicio" até o "inicio" da próxima. Adicionar versão = 1 linha lá (sem
// deploy). Nada é apagado da LOG QUIZ: só muda o recorte exibido. Padrão = a última.
const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID;
const TAB = "LOG QUIZ";
const TAB_VERSOES = "QUIZ_VERSOES";
// Fallback se a aba de versões sumir: trata como uma versão única desde o go-live.
const FALLBACK_INICIO = Date.UTC(2026, 6, 14, 3, 0, 0); // 14/07/2026 00:00 BRT

// Ordem canônica dos 21 passos (Sala #696): n0 pageview ... n20 checkout_click.
// O mapa de etapas MUDA quando o quiz é reestruturado. Cada versão (QUIZ_VERSOES,
// col mapa) aponta pro seu mapa aqui. Como o log guarda o step por NOME, o funil de
// cada versão usa a ordem certa e não mistura. Fonte de verdade = o index.html do quiz.
const MAPS = {
  // v1/v2 (go-live 14/07): 17 perguntas, result n18.
  v1: [
    "pageview", "idade", "estado", "t_autoridade", "tempo_treino", "freq", "desafio",
    "t_historia", "execucao", "cansa", "pico", "regiao", "conhece", "vsl1", "pos_vsl",
    "tempo_sessao", "t_prova", "proc", "result", "oferta", "checkout_click",
  ],
  // v3 (17/07, Sala #798): +barra (n9, entre execucao e cansa) +anota (n12, entre pico
  // e regiao). 19 perguntas, result n20, oferta n21, checkout n22.
  v3: [
    "pageview", "idade", "estado", "t_autoridade", "tempo_treino", "freq", "desafio",
    "t_historia", "execucao", "barra", "cansa", "pico", "anota", "regiao", "conhece",
    "vsl1", "pos_vsl", "tempo_sessao", "t_prova", "proc", "result", "oferta", "checkout_click",
  ],
};
const STEP_LABEL = {
  pageview: "Entrou na página", idade: "Idade", estado: "Estado",
  t_autoridade: "Texto de autoridade", tempo_treino: "Tempo de treino", freq: "Frequência",
  desafio: "Maior desafio", t_historia: "Texto de história", execucao: "Execução",
  barra: "Até onde a barra desce", cansa: "O que cansa", pico: "Pico de treino",
  anota: "Anota a carga?", regiao: "Região", conhece: "Já conhece o método",
  vsl1: "VSL 1 (mecanismo)", pos_vsl: "Depois da VSL 1", tempo_sessao: "Tempo por sessão",
  t_prova: "Texto de prova", proc: "Procrastinação", result: "Resultado (diagnóstico)",
  oferta: "Oferta (VSL 2 / preço)", checkout_click: "Clicou em comprar",
};

function getCredentials() {
  if (process.env.GOOGLE_CREDENTIALS_JSON) return JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
  const private_key = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  return { client_email: process.env.GOOGLE_CLIENT_EMAIL, private_key, project_id: process.env.GOOGLE_PROJECT_ID };
}
const round1 = (x) => Math.round(x * 10) / 10;
function serialToMs(num) { const ms = Math.round((num - 25569) * 86400000); return Number.isFinite(ms) ? ms : null; }
// col mista → instante UTC. Texto "DD/MM/YYYY[, HH:MM:SS]" é hora de BRT (UTC-3) →
// soma 3h. Serial do Sheets → aproximação (só afeta linhas antigas, fora das janelas).
function cellToMs(cell) {
  if (cell == null || cell === "") return null;
  const s = String(cell).trim();
  const m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return Date.UTC(+m[3], +m[2] - 1, +m[1], (m[4] ? +m[4] : 0) + 3, m[5] ? +m[5] : 0, m[6] ? +m[6] : 0);
  const num = parseFloat(s.replace(",", "."));
  if (!isNaN(num) && num > 30000 && num < 90000) return serialToMs(num);
  return null;
}

async function lerVersoes(sheets) {
  try {
    const rows = (await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `${TAB_VERSOES}!A2:E` })).data.values || [];
    const vs = rows
      .filter((r) => String(r[0] || "").trim().toLowerCase() === "peitao")
      .map((r) => ({ label: String(r[1] || "").trim() || "versão", iniMs: cellToMs(r[2]), obs: String(r[3] || "").trim(), mapa: String(r[4] || "").trim() || "v1" }))
      .filter((v) => v.iniMs != null)
      .sort((a, b) => a.iniMs - b.iniMs);
    if (vs.length) return vs;
  } catch { /* aba pode não existir */ }
  return [{ label: "atual", iniMs: FALLBACK_INICIO, obs: "", mapa: "v3" }];
}

export async function getPeitaoQuizStats({ versao } = {}) {
  if (!SPREADSHEET_ID) throw new Error("GOOGLE_SHEETS_ID não definido");
  const auth = new google.auth.GoogleAuth({ credentials: getCredentials(), scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"] });
  const sheets = google.sheets({ version: "v4", auth });

  const versoesAsc = await lerVersoes(sheets); // início asc
  // Janela de cada versão: [ini, próximo ini). Escolhida = por rótulo, senão a última.
  const idxSel = (() => {
    if (versao) { const i = versoesAsc.findIndex((v) => v.label === versao); if (i >= 0) return i; }
    return versoesAsc.length - 1;
  })();
  const sel = versoesAsc[idxSel];
  const iniMs = sel.iniMs;
  const fimMs = idxSel + 1 < versoesAsc.length ? versoesAsc[idxSel + 1].iniMs : Infinity;
  // pra o dropdown: mais recente primeiro.
  const versoes = [...versoesAsc].reverse().map((v) => ({ label: v.label, obs: v.obs }));

  // Mapa de etapas DESTA versão (v1 antigo, v3 com barra/anota). Interpreto os steps
  // com o mapa da versão selecionada — sessões de outras versões são filtradas fora.
  const STEP_ORDER = MAPS[sel.mapa] || MAPS.v1;
  const STEP_IDX = new Map(STEP_ORDER.map((s, i) => [s, i]));
  const IDX_PAGEVIEW = 0, IDX_COMECOU = 1;
  const IDX_OFERTA = STEP_IDX.get("oferta"), IDX_COMPROU = STEP_IDX.get("checkout_click");

  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `${TAB}!A2:G` });
  const rows = res.data.values || [];

  // Por sessão: maior índice de step + 1º ts (define a versão) + fonte. Só quiz=peitao.
  const sessions = new Map();
  for (const r of rows) {
    if (String(r[1] || "").trim().toLowerCase() !== "peitao") continue;
    const sid = String(r[3] || "").trim();
    if (!sid) continue;
    const step = String(r[2] || "").trim().toLowerCase();
    const idx = STEP_IDX.has(step) ? STEP_IDX.get(step) : -1;
    if (idx === -1) continue; // step fora do quiz atual (versão antiga renomeada etc.)
    const ts = cellToMs(r[0]);
    const fonte = String(r[4] || "").trim().toLowerCase() || "(sem fonte)";
    let s = sessions.get(sid);
    if (!s) { s = { maxIdx: -1, ts: null, fonte }; sessions.set(sid, s); }
    if (idx > s.maxIdx) s.maxIdx = idx;
    if (ts != null && (s.ts == null || ts < s.ts)) s.ts = ts; // 1º evento = início da sessão
    if ((!s.fonte || s.fonte === "(sem fonte)") && fonte !== "(sem fonte)") s.fonte = fonte;
  }

  // Só as sessões cujo início cai na janela da versão selecionada.
  const all = [...sessions.values()].filter((s) => s.ts != null && s.ts >= iniMs && s.ts < fimMs);
  const visitas = all.filter((s) => s.maxIdx >= IDX_PAGEVIEW).length;
  const comecaram = all.filter((s) => s.maxIdx >= IDX_COMECOU).length;
  const chegaramOferta = all.filter((s) => s.maxIdx >= IDX_OFERTA).length;
  const compraram = all.filter((s) => s.maxIdx >= IDX_COMPROU).length;

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
  let maiorQueda = null;
  for (let i = 1; i < funil.length; i++) {
    if (funil[i - 1].sessoes <= 0) continue;
    if (!maiorQueda || funil[i].retencao < maiorQueda.retencao) maiorQueda = { ...funil[i], de: funil[i - 1].label };
  }

  const fonteMap = new Map();
  for (const s of all) if (s.maxIdx >= IDX_COMECOU) fonteMap.set(s.fonte, (fonteMap.get(s.fonte) || 0) + 1);
  const porFonte = [...fonteMap.entries()].map(([fonte, count]) => ({ fonte, count, pct: comecaram ? round1((count / comecaram) * 100) : 0 })).sort((a, b) => b.count - a.count);

  return {
    visitas, comecaram, chegaramOferta, compraram,
    taxaVisitaComecou: visitas ? round1((comecaram / visitas) * 100) : 0,
    taxaComecouComprou: comecaram ? round1((compraram / comecaram) * 100) : 0,
    funil, maiorQueda, porFonte,
    versoes, versaoSel: sel.label, versaoObs: sel.obs,
  };
}
