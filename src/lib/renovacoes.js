import { google } from "googleapis";
import { getStudents } from "./sheets";

// Tela de Renovações (pro suporte): cruza a FILA de quem está chegando no
// vencimento (mestre CONTROLE ALUNOS) com quem JÁ RECEBEU o Raio-X (aba
// RAIOX_ENVIADOS, espelhada de hora em hora do log do operário RaioX pelo
// sync ~/webfit-mcp/raiox-enviados-sync.mjs). Marca quem recebeu e ainda não
// renovou = fila de cobrança do funcionário.
const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID;
// O Raio-X dispara faltando ~30 dias pro vencimento. "Vão receber" = quem AINDA NÃO
// cruzou esse ponto (venc > 30d) — nos próximos ~15 dias vai disparar. Quem já está
// a <30d sem Raio-X no log recebeu ANTES do log começar (26/06) e não é "vai receber".
const FILA_MIN = 30; // ainda não cruzou o gatilho dos 30 dias
const FILA_MAX = 45; // horizonte de antecedência (dispara em até ~15 dias)

function getCredentials() {
  if (process.env.GOOGLE_CREDENTIALS_JSON) return JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
  const private_key = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  return { client_email: process.env.GOOGLE_CLIENT_EMAIL, private_key, project_id: process.env.GOOGLE_PROJECT_ID };
}

const todayISO = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const brToISO = (v) => { const m = String(v || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : ""; };
const diasEntre = (aIso, bIso) => {
  if (!/^\d{4}-\d{2}-\d{2}/.test(aIso) || !/^\d{4}-\d{2}-\d{2}/.test(bIso)) return null;
  return Math.round((new Date(`${bIso.slice(0, 10)}T00:00:00`) - new Date(`${aIso.slice(0, 10)}T00:00:00`)) / 86400000);
};
// E.164 igual ao follow-sumidos: BR = 55+DDD+número; estrangeiro mantém o DDI.
const toE164 = (raw) => { const d = String(raw || "").replace(/\D/g, ""); if (!d) return ""; if (d.startsWith("55")) return d; return d.length <= 11 ? "55" + d : d; };

export async function getRenovacoes() {
  const students = await getStudents();

  // RAIOX_ENVIADOS (guardado: se a aba não existir, a fila ainda funciona)
  const enviadosBySid = new Map();
  try {
    const auth = new google.auth.GoogleAuth({ credentials: getCredentials(), scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"] });
    const sheets = google.sheets({ version: "v4", auth });
    const rows = (await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: "RAIOX_ENVIADOS!A2:D" })).data.values || [];
    for (const r of rows) { const sid = String(r[1] || "").trim(); if (sid) enviadosBySid.set(sid, { enviadoEm: String(r[0] || "").trim(), telefone: String(r[3] || "").trim() }); }
  } catch (e) {
    console.error("[renovacoes] RAIOX_ENVIADOS indisponível:", (e && e.message) || e);
  }

  // Dedup por sheetId: renovação reusa o mesmo sheetId (2 linhas no mestre: a
  // vencida antiga + a ativa nova). Fica a MELHOR linha por sheetId — Ativo vence,
  // senão o maior vencimento. Sem isso, o mesmo aluno duplicava na lista.
  const rankStatus = (st) => (st === "Ativo" ? 2 : st === "Vencido" ? 1 : 0);
  const bySid = new Map();
  for (const s of students) {
    const sid = (String(s.linkSite || "").match(/[?&]sheet=([\w-]+)/) || [])[1];
    if (!sid) continue; // sem app não entra no Raio-X
    const vencISO = brToISO(String(s.vencimentoProtocolo || "").trim() || s.dataVencimento);
    const cur = bySid.get(sid);
    const r = rankStatus(s.statusPlano);
    if (!cur || r > cur.r || (r === cur.r && vencISO > cur.vencISO)) bySid.set(sid, { s, r, vencISO });
  }

  const hoje = todayISO();
  const fila = [];
  const jaReceberam = [];

  for (const [sid, { s, vencISO }] of bySid) {
    const vencBR = String(s.vencimentoProtocolo || "").trim() || s.dataVencimento; // efetivo
    const diasProVenc = vencISO ? diasEntre(hoje, vencISO) : null;
    const cancelado = !!String(s.canceladoEm || "").trim() || s.statusPlano === "Cancelado";
    const pausado = !!String(s.pausadoEm || "").trim();
    const wa = toE164(s.contato);
    const env = enviadosBySid.get(sid);

    if (env) {
      // já recebeu o Raio-X. Renovou? Se o vencimento efetivo foi empurrado pra
      // bem depois do envio (o Raio-X sai ~30d antes de vencer), renovou.
      const diasAposEnvio = vencISO && env.enviadoEm ? diasEntre(env.enviadoEm.slice(0, 10), vencISO) : null;
      const renovou = diasAposEnvio != null && diasAposEnvio > 45;
      const situacao = cancelado ? "cancelou" : renovou ? "renovou" : "cobrar";
      jaReceberam.push({ nome: s.nome, wa: wa || toE164(env.telefone), enviadoEm: env.enviadoEm, venc: vencBR, diasProVenc, status: s.statusPlano, situacao });
    } else {
      // fila: ativo (não cancelado/pausado), AINDA não cruzou o gatilho dos ~30 dias
      // (venc entre FILA_MIN e FILA_MAX), sem Raio-X no log. Quem está a <30d sem
      // Raio-X recebeu antes do log começar (26/06) — não é "vai receber", fica fora.
      if (cancelado || pausado || s.statusPlano !== "Ativo") continue;
      if (diasProVenc == null || diasProVenc < FILA_MIN || diasProVenc > FILA_MAX) continue;
      fila.push({ nome: s.nome, wa, venc: vencBR, diasProVenc });
    }
  }

  fila.sort((a, b) => a.diasProVenc - b.diasProVenc); // mais urgente primeiro
  const ord = { cobrar: 0, renovou: 1, cancelou: 2 };
  jaReceberam.sort((a, b) => (ord[a.situacao] - ord[b.situacao]) || ((a.diasProVenc ?? 9999) - (b.diasProVenc ?? 9999)) || String(b.enviadoEm).localeCompare(String(a.enviadoEm)));

  return {
    fila,
    jaReceberam,
    aCobrar: jaReceberam.filter((x) => x.situacao === "cobrar").length,
  };
}
