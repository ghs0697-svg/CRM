import { google } from "googleapis";

// Retenção das VSLs (pedido LandingPage, Sala #698). Cada VSL dispara no /api/track
// um checkpoint a cada 10% assistido (1x por sessão), gravado na aba LOG QUIZ como
// step. Steps: <vid>_play, <vid>_p10 .. <vid>_p100, com vid ∈ {vsl1, vsl2, upsell}.
// vsl1/vsl2 vêm com quiz=peitao; upsell com quiz=consultoria (mas o step já
// identifica a VSL, então basta o step). A curva = sessões que chegaram em cada
// marca ÷ sessões que deram play. O maior degrau entre marcas = o trecho a corrigir.
//
// Robustez: conto por sessão o MAIOR checkpoint alcançado (não a contagem crua por
// step), o que garante curva monotônica mesmo se algum checkpoint intermediário não
// disparar. Equivale ao sid(pX)/sid(play) do #698 quando os eventos são completos.
const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID;
const TAB = "LOG QUIZ";

const VSLS = [
  { key: "vsl1", label: "VSL 1 · mecanismo", contexto: "Quiz do peito · “Por que teu peito não cresce”" },
  { key: "vsl2", label: "VSL 2 · oferta", contexto: "Quiz do peito · a oferta / preço" },
  { key: "upsell", label: "VSL upsell · consultoria", contexto: "Pós-compra · consultoria individual" },
];
// Cada VSL só conta no quiz certo (esquema #698): vsl1/vsl2 vêm do quiz do peito,
// upsell da página de consultoria. Isso descarta teste solto (ex: quiz=diag, #725)
// que porventura use um nome de step de VSL fora do lugar.
const QUIZ_DE = { vsl1: "peitao", vsl2: "peitao", upsell: "consultoria" };
// nível 0 = deu play; 1..10 = 10%..100%.
const MARCAS = ["Deu play", "10%", "20%", "30%", "40%", "50%", "60%", "70%", "80%", "90%", "100%"];

function getCredentials() {
  if (process.env.GOOGLE_CREDENTIALS_JSON) return JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
  const private_key = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  return { client_email: process.env.GOOGLE_CLIENT_EMAIL, private_key, project_id: process.env.GOOGLE_PROJECT_ID };
}
const round1 = (x) => Math.round(x * 10) / 10;

// Corte "zerar retenção": só conta sessões a partir de CRM_CONFIG!retencao_vsl_desde
// (o GH carimba a data/hora atual quando quer zerar os testes dele). null = sem corte.
function serialToMs(num) { const ms = Math.round((num - 25569) * 86400000); return Number.isFinite(ms) ? ms : null; }
function cellToMs(cell) {
  if (cell == null || cell === "") return null;
  const s = String(cell).trim();
  const m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return Date.UTC(+m[3], +m[2] - 1, +m[1], (m[4] ? +m[4] : 0) + 3, m[5] ? +m[5] : 0, m[6] ? +m[6] : 0);
  const num = parseFloat(s.replace(",", "."));
  if (!isNaN(num) && num > 30000 && num < 90000) return serialToMs(num);
  return null;
}
async function lerConfig(sheets) {
  const cfg = new Map();
  try {
    const rows = (await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: "CRM_CONFIG!A2:B" })).data.values || [];
    for (const r of rows) { const k = String(r[0] || "").trim(); if (k) cfg.set(k, String(r[1] || "").trim()); }
  } catch { /* sem config */ }
  return cfg;
}
// segundos -> "m:ss"
const mmss = (s) => { const t = Math.max(0, Math.round(s)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`; };
const DUR_KEY = { vsl1: "vsl1_duracao_s", vsl2: "vsl2_duracao_s", upsell: "upsell_duracao_s" };

// step "vsl1_play" -> {vid:"vsl1", nivel:0}; "vsl1_p30" -> {vid, nivel:3}; senão null.
function parseStep(step) {
  const m = String(step || "").trim().toLowerCase().match(/^(vsl1|vsl2|upsell)_(play|p(\d{1,3}))$/);
  if (!m) return null;
  const vid = m[1];
  const nivel = m[2] === "play" ? 0 : Math.round(Number(m[3]) / 10);
  if (nivel < 0 || nivel > 10) return null;
  return { vid, nivel };
}

export async function getVslRetencao() {
  if (!SPREADSHEET_ID) throw new Error("GOOGLE_SHEETS_ID não definido");
  const auth = new google.auth.GoogleAuth({ credentials: getCredentials(), scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"] });
  const sheets = google.sheets({ version: "v4", auth });
  const cfg = await lerConfig(sheets);
  const corteMs = cellToMs(cfg.get("retencao_vsl_desde")); // zerar retenção: só conta a partir daqui
  const rows = (await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `${TAB}!A2:G` })).data.values || [];

  // Por VSL: Map<sid, { n: maiorNivel, ts: 1º evento }>.
  const porVsl = new Map(VSLS.map((v) => [v.key, new Map()]));
  for (const r of rows) {
    const p = parseStep(r[2]);
    if (!p) continue;
    if (String(r[1] || "").trim().toLowerCase() !== QUIZ_DE[p.vid]) continue; // VSL no quiz certo
    const sid = String(r[3] || "").trim();
    if (!sid) continue;
    const ts = cellToMs(r[0]);
    const m = porVsl.get(p.vid);
    const cur = m.get(sid);
    if (!cur) m.set(sid, { n: p.nivel, ts });
    else { if (p.nivel > cur.n) cur.n = p.nivel; if (ts != null && (cur.ts == null || ts < cur.ts)) cur.ts = ts; }
  }

  const vsls = VSLS.map((v) => {
    const m = porVsl.get(v.key);
    // aplica o corte de "zerar": só sessões cujo 1º evento é >= o corte.
    const sids = [...m.values()].filter((o) => corteMs == null || (o.ts != null && o.ts >= corteMs)).map((o) => o.n);
    const play = sids.length; // qualquer evento da VSL implica que deu play (nível >= 0)
    // duração do vídeo (CRM_CONFIG) → segundo de cada marca (10% = 10% da duração).
    const durS = parseFloat(cfg.get(DUR_KEY[v.key]));
    const duracaoS = Number.isFinite(durS) && durS > 0 ? durS : null;
    // curva: nº de sessões com maiorNivel >= L, pra cada marca.
    const curva = MARCAS.map((marca, L) => {
      const sessoes = sids.filter((n) => n >= L).length;
      const seg = duracaoS != null ? (L * duracaoS) / 10 : null;
      return { marca, nivel: L, sessoes, pct: play ? round1((sessoes / play) * 100) : 0, seg, segLabel: seg != null ? mmss(seg) : null };
    });
    for (let i = 0; i < curva.length; i++) {
      const prev = i > 0 ? curva[i - 1].sessoes : curva[i].sessoes;
      curva[i].retencao = prev ? round1((curva[i].sessoes / prev) * 100) : 0;
      curva[i].dropPct = i > 0 ? round1(curva[i - 1].pct - curva[i].pct) : 0;
    }
    // maior degrau (queda de % entre uma marca e a seguinte), só se houver play.
    let maiorQueda = null;
    for (let i = 1; i < curva.length; i++) {
      if (curva[i - 1].sessoes <= 0) continue;
      if (!maiorQueda || curva[i].dropPct > maiorQueda.dropPct) maiorQueda = { de: curva[i - 1].marca, para: curva[i].marca, dropPct: curva[i].dropPct };
    }
    const assistiuTudo = curva[10].sessoes;
    return { key: v.key, label: v.label, contexto: v.contexto, play, assistiuTudo,
      pctAssistiuTudo: play ? round1((assistiuTudo / play) * 100) : 0,
      duracaoS, duracaoLabel: duracaoS != null ? mmss(duracaoS) : null, curva, maiorQueda };
  });

  return { vsls };
}
