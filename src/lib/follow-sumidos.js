import { google } from "googleapis";

// Follow-up automático de aluno SUMIDO do app.
// Fonte: aba LOGS da mestre (1 linha = 1 dia concluído pelo app) como piso de "já usou o
// app alguma vez", refinada pela última ATIVIDADE (heartbeat de abertura + marcação).
// Cruza com CONTROLE ALUNOS (por SheetId no link col W) pra pegar telefone + status.
//
// Critério (decisão GH, atualizado #407): ativo + já usou o app + 7+ dias SEM nenhum
// sinal de vida no app (abrir, marcar, fechar dia), sem teto. Gatilho = "sumiu do app".
// Cadência (decisão GH 2026-06-19): UMA mensagem por EPISÓDIO de inatividade. Quando
// o aluno cruza 7 dias sem treinar, recebe 1 mensagem. Enquanto seguir parado NÃO
// recebe de novo (mesmo 30 dias seguidos = 1 msg só). Só abre novo episódio (= nova
// mensagem) se treinar de novo e voltar a sumir 7+ dias. Marcador do episódio:
// ultimoContato >= ultimoTreino significa que o episódio atual já foi coberto.
// Envio: o CRM NÃO manda WhatsApp — só mantém a aba. O Make lê as linhas com
//        elegivelAgora=SIM, dispara via Z-API em drip lento (anti-ban) e carimba
//        ultimoContato de volta. Isso marca o episódio como coberto (1 msg/episódio).
//
// Estado visível na aba FOLLOW_SUMIDOS da mestre (GH audita / edita à mão).

const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID;
const MASTER_TAB = process.env.GOOGLE_SHEETS_TAB || "CONTROLE ALUNOS";
const LOGS_TAB = "LOGS";
const FOLLOW_TAB = "FOLLOW_SUMIDOS";

const IDLE_MIN_DAYS = 7;   // 7+ dias parado entra no roster
// (sem recontato por tempo: 1 msg por episódio — ver episodioJaContatado)

const HEADER = [
  "sheetId", "nome", "telefone", "status", "ultimoTreino",
  "diasSemTreinar", "ultimoContato", "vezes", "elegivelAgora", "atualizadoEm",
  "primeiroNome", "mensagem",
];

const primeiroNome = (nome) => (String(nome || "").trim().split(/\s+/)[0] || "");

// Mensagem pronta (sem nome). 3 variações; o CRM já escolhe uma por linha pra
// o Make não precisar de fórmula nenhuma. Sem aspas duplas (JSON-safe).
const MENSAGENS = [
  "Opa! 👊 Vi que faz uns dias que tu não abre o app. Tá tudo certo? Se travou em algo (correria, lesão, dúvida no protocolo) me chama que a gente resolve. Bora retomar o ritmo! 💪",
  "E aí! Sumiu do app esses dias, deu pra sentir tua falta por aqui 😄 Aconteceu alguma coisa? Se precisar ajustar treino ou dieta é só falar. Tamo junto! 🔥",
  "Fala! 👊 Faz um tempinho que tu não dá as caras no app. Bora não deixar o shape esfriar? Qualquer dificuldade (tempo, lesão, dúvida) me conta que eu ajusto contigo. 💪",
];
// rotação determinística: varia por aluno (hash do sheetId) e a cada re-contato (vezes)
function pickMensagem(sheetId, vezes) {
  const s = String(sheetId || "");
  let h = 0;
  for (let i = 0; i < s.length; i++) h += s.charCodeAt(i);
  return MENSAGENS[(h + (parseInt(vezes, 10) || 0)) % MENSAGENS.length];
}

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
// Data de hoje no fuso BRT (igual às datas da mestre, gravadas em America/Sao_Paulo
// pelo Apps Script: LOGS col D e os Timestamps de CARGAS/ESFORCO/PROGRESSO). Sem o fuso
// explícito, na Vercel (TZ=UTC) "hoje" vira o dia seguinte das ~21h à meia-noite BRT e
// inflava diasSemTreinar em 1 na borda dos 7 dias. 'en-CA' já formata YYYY-MM-DD.
// Espelha o todayBR() do sheets.js.
function todayISO() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}
function daysBetween(aIso, bIso) {
  const a = parseISO(aIso), b = parseISO(bIso);
  if (!a || !b) return null;
  return Math.floor((b - a) / 86400000);
}
// Timestamp pt-BR ("DD/MM/YYYY HH:mm:ss", como vem de CARGAS/ESFORCO/PROGRESSO via
// Sheets API) -> "YYYY-MM-DD" (mesmo formato do "Data Treino" do LOGS, col D). Fallback
// pro serial do Sheets (raro). "" quando não dá pra ler.
function brTsToISO(cell) {
  const s = String(cell == null ? "" : cell).trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  const num = parseFloat(s.replace(",", "."));
  if (!isNaN(num) && num > 30000 && num < 90000) {
    const d = new Date(Math.round((num - 25569) * 86400000));
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
  }
  return "";
}
// E.164: BR = 55+DDD+número; estrangeiro mantém o DDI próprio (regra da skill de telefone).
function toE164(raw) {
  const d = onlyDigits(raw);
  if (!d) return "";
  if (d.startsWith("55")) return d;
  if (d.length <= 11) return "55" + d; // BR sem DDI escrito
  return d;                            // já tem DDI internacional
}

// 1 msg por episódio: o episódio atual já foi coberto se o último contato aconteceu
// DEPOIS (ou no dia) do último treino. Se o aluno treinou de novo (ultimoTreino mais
// recente que ultimoContato), abre um episódio novo e fica elegível de novo.
function episodioJaContatado(ultimoContato, ultimoTreino) {
  if (!ultimoContato) return false;            // nunca contatado -> elegível
  const c = parseISO(ultimoContato), t = parseISO(ultimoTreino);
  if (!c || !t) return true;                   // datas estranhas -> conservador (não re-manda)
  return c >= t;                               // contatado após o último treino = episódio coberto
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

  // 1b) Última ATIVIDADE no app, não só "dia concluído" (Sala #404 + #407). O critério
  // virou "sumiu do APP", não "sumiu do treino": o "último sinal de vida" tem que contar
  // toda interação, não só o fechamento de dia do LOGS. Aluno que marca exercícios mas
  // não fecha o dia ficava com dataTreino velho e era flagado errado (caso Rogério).
  // Sinais (todos col A = Timestamp pt-BR, col B = SheetId; conta marcar E desmarcar,
  // espelha o raioxSummary_ do .gs):
  //   - ATIVIDADE: HEARTBEAT de abertura (logPing_) — o sinal-REI: 1 linha por aluno/dia
  //     só de ABRIR o app, mesmo sem marcar nada. Como qualquer interação (marcar carga,
  //     pedir ajuste) passa por abrir o app, ATIVIDADE subsume os demais sinais.
  //   - CARGAS/ESFORCO/PROGRESSO: marcação de exercício/carga/esforço (defesa extra).
  // última atividade = MAX Timestamp do aluno entre essas abas. SÓ ATUALIZA sid que JÁ
  // existe no `last` (quem já fechou dia alguma vez): não adiciona ninguém, então isto só
  // REDUZ falso-positivo, nunca expande o roster.
  //
  // Robustez: (a) isto é REFINO — NÃO pode derrubar o ciclo base (LOGS+CONTROLE): o
  // try/catch degrada pras datas do LOGS se o Sheets falhar (429/timeout/aba renomeada);
  // (b) as abas são append-only e crescem pra sempre — lê só a CAUDA (últimas
  // ACT_WINDOW linhas), que cobre de sobra os 7 dias do critério e limita payload/tempo
  // no cron de 60s. Atividade mais velha que a janela só afeta quem já está 25k+ linhas
  // (semanas) sem nenhum sinal — esse fica no roster de qualquer jeito (>7 dias).
  try {
    const ACT_TABS = ["ATIVIDADE", "CARGAS", "ESFORCO", "PROGRESSO"];
    const ACT_WINDOW = 25000;
    const meta = await sh.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID,
      fields: "sheets(properties(title,gridProperties(rowCount)))",
    });
    const rowCount = new Map((meta.data.sheets || []).map((s) => [s.properties.title, (s.properties.gridProperties || {}).rowCount || 0]));
    const ranges = ACT_TABS.map((t) => `${t}!A${Math.max(2, (rowCount.get(t) || 0) - ACT_WINDOW)}:B`);
    const actBatch = await sh.spreadsheets.values.batchGet({ spreadsheetId: SPREADSHEET_ID, ranges });
    for (const vr of actBatch.data.valueRanges || []) {
      for (const row of vr.values || []) {
        const sid = String(row[1] || "").trim();
        const lw = sid && last.get(sid);
        if (!lw) continue;                       // só quem já tem LOGS (não expande roster)
        const actIso = brTsToISO(row[0]);
        if (actIso && actIso > lw.dataTreino) lw.dataTreino = actIso;
      }
    }
  } catch (e) {
    console.error("follow-sumidos: merge de atividade (CARGAS/ESFORCO/PROGRESSO) falhou, seguindo só com LOGS:", (e && e.message) || e);
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

  // 1 msg por episódio: elegível só se o episódio atual ainda NÃO foi coberto
  // (nunca contatado, ou treinou de novo depois do último contato e voltou a sumir).
  // Enquanto seguir parado sem treinar, ultimoContato>=ultimoTreino => não repete.
  for (const s of roster) {
    const p = prevBySid.get(s.sheetId) || { ultimoContato: "", vezes: 0 };
    s.ultimoContato = p.ultimoContato;
    s.vezes = p.vezes;
    s.elegivel = !episodioJaContatado(s.ultimoContato, s.ultimoTreino);
  }
  const elegiveis = roster.filter((s) => s.elegivel);

  if (dryRun) {
    return { dryRun: true, total: roster.length, elegiveis: elegiveis.length, roster };
  }

  // Grava a aba inteira (header + roster). O CRM NÃO manda WhatsApp: quem manda
  // é o Make, lendo as linhas com elegivelAgora=SIM, disparando via Z-API em drip
  // e carimbando de volta ultimoContato + vezes. Como ultimoContato passa a ser
  // >= ultimoTreino, o episódio fica coberto e não repete. Quem treinou de novo
  // (<7 dias) sai do roster; se sumir 7+ de novo, volta SEM contato = novo episódio.
  // O ultimoContato/vezes do ciclo anterior é preservado acima.
  const rows = roster.map((s) => [
    s.sheetId, s.nome, s.telefone, s.status, s.ultimoTreino,
    s.diasSemTreinar, s.ultimoContato || "", s.vezes || 0, s.elegivel ? "SIM" : "", today,
    primeiroNome(s.nome), pickMensagem(s.sheetId, s.vezes),
  ]);
  await shRW.spreadsheets.values.clear({ spreadsheetId: SPREADSHEET_ID, range: `${FOLLOW_TAB}!A:L` });
  await shRW.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${FOLLOW_TAB}!A1`,
    valueInputOption: "RAW",
    requestBody: { values: [HEADER, ...rows] },
  });

  return { total: roster.length, elegiveis: elegiveis.length };
}
