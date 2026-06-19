import { google } from "googleapis";

// Follow-up automático de aluno SUMIDO da academia.
// Fonte: aba LOGS da mestre (1 linha = 1 treino concluído pelo app). Cruza com
// CONTROLE ALUNOS (por SheetId no link col W) pra pegar telefone + status.
//
// Critério (decisão GH): ativo + já treinou pelo app + 7+ dias SEM treinar (sem teto).
// Cadência: re-dispara a cada 7 dias enquanto seguir sumido ("ficar em cima").
// Envio: o CRM NÃO manda WhatsApp — só mantém a aba. O Make lê as linhas com
//        elegivelAgora=SIM, dispara via Z-API em drip lento (anti-ban) e carimba
//        ultimoContato de volta (zera o elegivelAgora por 7 dias = a cadência).
//
// Estado visível na aba FOLLOW_SUMIDOS da mestre (GH audita / edita à mão).

const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID;
const MASTER_TAB = process.env.GOOGLE_SHEETS_TAB || "CONTROLE ALUNOS";
const LOGS_TAB = "LOGS";
const FOLLOW_TAB = "FOLLOW_SUMIDOS";

const IDLE_MIN_DAYS = 7;   // 7+ dias parado entra
const RECONTACT_DAYS = 7;  // recobra a cada 7 dias

const HEADER = [
  "sheetId", "nome", "telefone", "status", "ultimoTreino",
  "diasSemTreinar", "ultimoContato", "vezes", "elegivelAgora", "atualizadoEm",
];

function getCredentials() {
  if (process.env.GOOGLE_CREDENTIALS_JSON) return JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
  const private_key = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  return { client_email: process.env.GOOGLE_CLIENT_EMAIL, private_key, project_id: process.env.GOOGLE_PROJECT_ID };
}
function sheetsClient(write = false) {
  const auth = new google.auth.GoogleAuth({
    credentials: getCredentials(),
    scopes: [write ? "https://www.googleapis.com/auth/spreadsheets" : "https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  return google.sheets({ version: "v4", auth });
}

const onlyDigits = (v) => String(v == null ? "" : v).replace(/\D/g, "");
const parseISO = (s) => {
  const m = String(s || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00`) : null;
};
function todayISO() {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function daysBetween(aIso, bIso) {
  const a = parseISO(aIso), b = parseISO(bIso);
  if (!a || !b) return null;
  return Math.floor((b - a) / 86400000);
}
// E.164: BR = 55+DDD+número; estrangeiro mantém o DDI próprio (regra da skill de telefone).
function toE164(raw) {
  const d = onlyDigits(raw);
  if (!d) return "";
  if (d.startsWith("55")) return d;
  if (d.length <= 11) return "55" + d; // BR sem DDI escrito
  return d;                            // já tem DDI internacional
}

// Monta o roster: ativos, com treino no app, 7+ dias parados. Ordenado por dias asc.
export async function computeSumidos() {
  if (!SPREADSHEET_ID) throw new Error("GOOGLE_SHEETS_ID não definido");
  const sh = sheetsClient(false);

  // 1) último treino por SheetId (aba LOGS)
  const logs = (await sh.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `${LOGS_TAB}!A2:K` })).data.values || [];
  const last = new Map();
  for (const r of logs) {
    const sid = String(r[2] || "").trim();
    const dt = String(r[3] || "").trim();
    if (!sid || !/^\d{4}-\d{2}-\d{2}$/.test(dt)) continue;
    const cur = last.get(sid);
    const totalDias = parseInt(r[8], 10) || 0;
    if (!cur) last.set(sid, { dataTreino: dt, nome: String(r[1] || "").trim(), totalDias });
    else {
      if (dt > cur.dataTreino) { cur.dataTreino = dt; if (String(r[1] || "").trim()) cur.nome = String(r[1]).trim(); }
      cur.totalDias = Math.max(cur.totalDias, totalDias);
    }
  }

  // 2) join CONTROLE ALUNOS por SheetId (link col W) -> telefone, status, nome
  const ca = (await sh.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `${MASTER_TAB}!A2:W` })).data.values || [];
  const bySid = new Map();
  for (const r of ca) {
    const m = String(r[22] || "").match(/[?&]sheet=([\w-]+)/);
    if (m) bySid.set(m[1], { nome: String(r[0] || "").trim(), telefone: toE164(r[1]), status: String(r[10] || "").trim() });
  }

  // 3) filtro: ativo + tem linha no mestre + telefone + idle>=7
  const today = todayISO();
  const roster = [];
  for (const [sid, lw] of last) {
    const cm = bySid.get(sid);
    if (!cm || cm.status !== "Ativo" || !cm.telefone) continue;
    const dias = daysBetween(lw.dataTreino, today);
    if (dias == null || dias < IDLE_MIN_DAYS) continue;
    roster.push({
      sheetId: sid, nome: cm.nome || lw.nome, telefone: cm.telefone, status: cm.status,
      ultimoTreino: lw.dataTreino, diasSemTreinar: dias, totalDias: lw.totalDias,
    });
  }
  roster.sort((a, b) => a.diasSemTreinar - b.diasSemTreinar);
  return roster;
}

async function ensureFollowTab(shRW) {
  const meta = await shRW.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID, fields: "sheets(properties(title))" });
  const exists = (meta.data.sheets || []).some((s) => s.properties.title === FOLLOW_TAB);
  if (!exists) {
    await shRW.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { requests: [{ addSheet: { properties: { title: FOLLOW_TAB } } }] },
    });
  }
}

/**
 * Roda o ciclo: computa roster, aplica cadência (último contato), grava a aba
 * FOLLOW_SUMIDOS e dispara os elegíveis pro Make. Idempotente no dia.
 * opts.dryRun = só computa e devolve (não grava nem dispara).
 */
export async function runFollowSumidos({ dryRun = false } = {}) {
  const roster = await computeSumidos();
  const today = todayISO();
  const shRW = sheetsClient(true);
  await ensureFollowTab(shRW);

  // estado anterior (ultimoContato/vezes) por sheetId — preserva o que o ciclo já registrou
  const prev = (await shRW.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `${FOLLOW_TAB}!A2:J` })).data.values || [];
  const prevBySid = new Map();
  for (const r of prev) {
    const sid = String(r[0] || "").trim();
    if (sid) prevBySid.set(sid, { ultimoContato: String(r[6] || "").trim(), vezes: parseInt(r[7], 10) || 0 });
  }

  // cadência: elegível se nunca contatado OU último contato >= 7 dias
  for (const s of roster) {
    const p = prevBySid.get(s.sheetId) || { ultimoContato: "", vezes: 0 };
    s.ultimoContato = p.ultimoContato;
    s.vezes = p.vezes;
    const since = s.ultimoContato ? daysBetween(s.ultimoContato, today) : null;
    s.elegivel = since == null || since >= RECONTACT_DAYS;
  }
  const elegiveis = roster.filter((s) => s.elegivel);

  if (dryRun) {
    return { dryRun: true, total: roster.length, elegiveis: elegiveis.length, roster };
  }

  // Grava a aba inteira (header + roster). O CRM NÃO manda WhatsApp: quem manda
  // é o Make, lendo as linhas com elegivelAgora=SIM, disparando via Z-API em drip
  // e carimbando de volta ultimoContato + vezes (isso zera o elegivelAgora por 7
  // dias = a cadência). Quem treinou de novo (<7 dias) sai do roster e some da
  // aba neste ciclo. O ultimoContato/vezes do ciclo anterior é preservado acima.
  const rows = roster.map((s) => [
    s.sheetId, s.nome, s.telefone, s.status, s.ultimoTreino,
    s.diasSemTreinar, s.ultimoContato || "", s.vezes || 0, s.elegivel ? "SIM" : "", today,
  ]);
  await shRW.spreadsheets.values.clear({ spreadsheetId: SPREADSHEET_ID, range: `${FOLLOW_TAB}!A:J` });
  await shRW.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${FOLLOW_TAB}!A1`,
    valueInputOption: "RAW",
    requestBody: { values: [HEADER, ...rows] },
  });

  return { total: roster.length, elegiveis: elegiveis.length };
}
