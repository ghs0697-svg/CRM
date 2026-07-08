import { google } from "googleapis";

// Funil de leads do ManyChat — planilha "Controle Leads ManyChat".
// Aba PAINEL (diário, já agregado): linha 4 é o cabeçalho, dados a partir da 5.
//   A Data · B Dia · C Boas Vindas · D FRIO · E MORNO · F QUENTE · G LINK · ...
const LEADS_SHEET_ID = process.env.LEADS_SHEET_ID || "1PzUnZx6fNv-by0H1A9QZzDpp5jJJ4hOmp2LOuuLQrXE";

function getCredentials() {
  if (process.env.GOOGLE_CREDENTIALS_JSON) return JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
  const private_key = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  return {
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    private_key,
    project_id: process.env.GOOGLE_PROJECT_ID,
  };
}

const numInt = (v) => parseInt(String(v ?? "").replace(/[^\d-]/g, ""), 10) || 0;
// Tolerante a dia/mês com 1 dígito ("1/7/2026") pra não descartar linha em silêncio.
const isDataBR = (v) => /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(String(v || "").trim());
const brToISO = (d) => {
  const m = String(d).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : "";
};
// "Hoje" no fuso de São Paulo (a Vercel roda em UTC: das 21h à meia-noite BRT o
// toISOString() já virou o dia seguinte e deixava passar a linha zerada de amanhã).
// Espelha o todayISO() do follow-sumidos.js.
const todayISO = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
// Segunda-feira (ISO) da semana de uma data YYYY-MM-DD — pra agrupar safras por semana.
const mondayOf = (iso) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const ddmm = (iso) => { const m = String(iso).match(/^\d{4}-(\d{2})-(\d{2})$/); return m ? `${m[2]}/${m[1]}` : iso; };

export async function getFunilStats(mes) {
  const auth = new google.auth.GoogleAuth({
    credentials: getCredentials(),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const sheets = google.sheets({ version: "v4", auth });

  const res = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: LEADS_SHEET_ID,
    ranges: ["PAINEL!A5:G"],
  });
  const painel = res.data.valueRanges?.[0]?.values || [];

  const dias = [];
  for (const r of painel) {
    if (!isDataBR(r[0])) continue;
    dias.push({
      data: String(r[0]).trim(),
      dia: String(r[1] || "").trim(),
      boasVindas: numInt(r[2]),
      frio: numInt(r[3]),
      morno: numInt(r[4]),
      quente: numInt(r[5]),
      link: numInt(r[6]),
    });
  }
  dias.sort((a, b) => brToISO(a.data).localeCompare(brToISO(b.data)));
  // Remove dias FUTUROS (a planilha pré-preenche datas adiante com zeros).
  const hojeISO = todayISO();
  const diasReais = dias.filter((d) => { const iso = brToISO(d.data); return iso && iso <= hojeISO; });

  // Filtro de mês. meses = YYYY-MM disponíveis (mais recente primeiro).
  // mes = "YYYY-MM" filtra aquele mês · mes = "todos" agrega tudo · sem mes = default no mês mais recente.
  const meses = [...new Set(diasReais.map((d) => brToISO(d.data).slice(0, 7)).filter(Boolean))].sort().reverse();
  let mesSel;
  if (mes === "todos") mesSel = "todos";
  else if (mes && meses.includes(mes)) mesSel = mes;
  else mesSel = meses[0] || "todos";
  const diasUsados = mesSel === "todos" ? diasReais : diasReais.filter((d) => brToISO(d.data).slice(0, 7) === mesSel);

  const totals = diasUsados.reduce(
    (t, d) => ({
      boasVindas: t.boasVindas + d.boasVindas,
      frio: t.frio + d.frio,
      morno: t.morno + d.morno,
      quente: t.quente + d.quente,
      link: t.link + d.link,
    }),
    { boasVindas: 0, frio: 0, morno: 0, quente: 0, link: 0 }
  );
  const pct = (n) => (totals.boasVindas ? Math.round((n / totals.boasVindas) * 1000) / 10 : 0);
  totals.pctMorno = pct(totals.morno);
  totals.pctQuente = pct(totals.quente);
  totals.pctLink = pct(totals.link);

  // Linktree (cliques por link) — aba LINKTREE da MESMA sheet, escrita pelo coletor do CRM
  // (~/webfit-mcp/linktree/coletor-linktree.mjs, cron no Mac). Leitura separada e guardada:
  // se a aba ainda não existe, o /funil não quebra.
  let linktree = [];
  let linktreeAtualizado = null;
  try {
    const lt = await sheets.spreadsheets.values.get({ spreadsheetId: LEADS_SHEET_ID, range: "LINKTREE!A2:I" });
    for (const r of (lt.data.values || [])) {
      if (!r[1]) continue; // sem tr_ee_id = linha vazia
      linktree.push({
        id: String(r[1]).trim(),
        label: String(r[2] || "").trim(),
        tipo: String(r[3] || "").trim(),
        destino: String(r[4] || "").trim(),
        c24: numInt(r[5]), c7: numInt(r[6]), c28: numInt(r[7]), total: numInt(r[8]),
      });
      if (!linktreeAtualizado && r[0]) linktreeAtualizado = String(r[0]).trim();
    }
    linktree.sort((a, b) => b.c7 - a.c7 || b.total - a.total);
  } catch (e) {
    // Não engole calado: se a aba LINKTREE sumir/renomear ou a permissão cair,
    // isso tem que aparecer no log do servidor (antes desaparecia sem rastro).
    console.error("[funil] leitura da aba LINKTREE falhou:", (e && e.message) || e);
    linktree = [];
  }

  const recent = mesSel === "todos" ? diasUsados.slice(-30).reverse() : [...diasUsados].reverse();

  // Conversão POR SAFRA (aba FUNIL_SAFRA, escrita de hora em hora pela lane Agentes
  // a partir do /api/funil — deduplicada por subscriber_id). É o funil REAL: "dos que
  // entraram no dia X, % que chegou a cada degrau", diferente do volume/dia do PAINEL.
  // Colunas: A Dia(YYYY-MM-DD) · B Entraram · C FRIO · D MORNO · E QUENTE · F LINK
  // (+ colunas de % que ignoro e recalculo). Última linha = TOTAL. Leitura guardada.
  let safraDias = [];
  let safraTotal = null;
  try {
    const sf = await sheets.spreadsheets.values.get({ spreadsheetId: LEADS_SHEET_ID, range: "FUNIL_SAFRA!A2:F" });
    for (const r of (sf.data.values || [])) {
      const dia = String(r[0] || "").trim();
      const linha = { entraram: numInt(r[1]), frio: numInt(r[2]), morno: numInt(r[3]), quente: numInt(r[4]), link: numInt(r[5]) };
      if (dia.toUpperCase() === "TOTAL") { safraTotal = linha; continue; }
      if (/^\d{4}-\d{2}-\d{2}$/.test(dia)) safraDias.push({ dia, ...linha });
    }
    safraDias.sort((a, b) => a.dia.localeCompare(b.dia));
  } catch (e) {
    console.error("[funil] leitura da aba FUNIL_SAFRA falhou:", (e && e.message) || e);
  }

  // Aplica o MESMO filtro de mês do painel de volume. Resumo do período = soma das
  // safras do mês (cada lead tem 1 safra só, então somar dias não duplica); em "todos"
  // usa a linha TOTAL da aba. pctX = X / entraram (conversão da entrada).
  const safraNoMes = mesSel === "todos" ? safraDias : safraDias.filter((d) => d.dia.slice(0, 7) === mesSel);
  const somaMes = safraNoMes.reduce((t, d) => ({
    entraram: t.entraram + d.entraram, frio: t.frio + d.frio, morno: t.morno + d.morno, quente: t.quente + d.quente, link: t.link + d.link,
  }), { entraram: 0, frio: 0, morno: 0, quente: 0, link: 0 });
  const safraResumo = mesSel === "todos" && safraTotal ? safraTotal : somaMes;
  const cpct = (n) => (safraResumo.entraram ? Math.round((n / safraResumo.entraram) * 1000) / 10 : 0);
  // Granularidade adaptativa: visão geral ("todos") agrupa por SEMANA (suaviza o
  // ruído do dia a dia, ~14-30 leads/dia); mês selecionado mostra DIA (detalhe).
  const granularidade = mesSel === "todos" ? "semana" : "dia";
  let linhas;
  if (granularidade === "semana") {
    const wk = new Map();
    for (const d of safraNoMes) {
      const k = mondayOf(d.dia);
      const c = wk.get(k) || { dia: k, label: `sem. ${ddmm(k)}`, entraram: 0, frio: 0, morno: 0, quente: 0, link: 0 };
      c.entraram += d.entraram; c.frio += d.frio; c.morno += d.morno; c.quente += d.quente; c.link += d.link;
      wk.set(k, c);
    }
    linhas = [...wk.values()].sort((a, b) => a.dia.localeCompare(b.dia)).slice(-12);
  } else {
    linhas = safraNoMes.map((d) => ({ ...d, label: d.dia.split("-").reverse().join("/") }));
  }
  const safra = {
    disponivel: safraDias.length > 0,
    granularidade,
    resumo: { ...safraResumo, pctFrio: cpct(safraResumo.frio), pctMorno: cpct(safraResumo.morno), pctQuente: cpct(safraResumo.quente), pctLink: cpct(safraResumo.link) },
    dias: linhas
      .map((d) => ({ ...d, pctMorno: d.entraram ? Math.round((d.morno / d.entraram) * 1000) / 10 : 0, pctQuente: d.entraram ? Math.round((d.quente / d.entraram) * 1000) / 10 : 0, pctLink: d.entraram ? Math.round((d.link / d.entraram) * 1000) / 10 : 0 }))
      .reverse(),
  };

  return { totals, recent, linktree, linktreeAtualizado, meses, mesSel, safra };
}
