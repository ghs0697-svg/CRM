import { google } from "googleapis";

const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID;
const TAB = process.env.GOOGLE_SHEETS_TAB || ""; // vazio = primeira aba
const RANGE = TAB ? `${TAB}!A2:AB` : "A2:AB";

// Mapeamento posicional Sheets → camelCase.
// A ordem AQUI deve bater 1:1 com a ordem FÍSICA das colunas A..W na planilha.
const COLUMN_KEYS = [
  "nome",                  // A
  "contato",               // B  (chega como "https://wa.me/...")
  "dataCompra",            // C  DD/MM/YYYY
  "protocoloInicial",      // D
  "protocoloAtual",        // E
  "versaoAtual",           // F
  "tipoPlano",             // G  Anual | Trimestral | Semestral | Mensal
  "protocoloHormonal",     // H  Sim | Não
  "valorPlano",            // I
  "dataVencimento",        // J  formula
  "statusPlano",           // K  formula — Ativo | Vencido
  "dataContatoRenovacao",  // L  formula
  "proximoReajuste",       // M
  "acaoNecessaria",        // N  formula — OK | Plano Vencido!
  "dataPagamento",         // O
  "formaPagamento",        // P  Pix | Greenn | Cartão
  "totalRec",              // Q
  "cpf",                   // R
  "tags",                  // S
  "peptideos",             // T
  "mesesExtras",           // U
  "categoria",             // V
  "linkSite",              // W
  "renovacao",             // X  Renovação?
  "canceladoEm",           // Y  Cancelado em
  "pausadoEm",             // Z  Pausado em
  "diasExtras",            // AA Dias extras
  "vencimentoProtocolo",   // AB formula — Vencimento (protocolo): base D(entrega) fallback C(compra). Contrato Sala #512.
];

let cachedClient = null;

function getAuth() {
  if (process.env.GOOGLE_CREDENTIALS_JSON) {
    const parsed = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
    return new google.auth.GoogleAuth({
      credentials: parsed,
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });
  }
  const client_email = process.env.GOOGLE_CLIENT_EMAIL;
  const private_key = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  const project_id = process.env.GOOGLE_PROJECT_ID;
  if (!client_email || !private_key) {
    throw new Error(
      "Service account não configurada. Defina GOOGLE_CREDENTIALS_JSON OU (GOOGLE_CLIENT_EMAIL + GOOGLE_PRIVATE_KEY) em .env.local"
    );
  }
  return new google.auth.GoogleAuth({
    credentials: { client_email, private_key, project_id },
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
}

async function getSheetsClient() {
  if (cachedClient) return cachedClient;
  const auth = getAuth();
  cachedClient = google.sheets({ version: "v4", auth });
  return cachedClient;
}

function rowToObject(row, sheetRowNumber) {
  const obj = { _rowIndex: sheetRowNumber }; // linha real na planilha (1-based, header é 1)
  for (let i = 0; i < COLUMN_KEYS.length; i++) {
    const v = row[i];
    obj[COLUMN_KEYS[i]] = v === undefined || v === null ? "" : String(v);
  }
  return obj;
}

// Telefone canônico BR pra agrupar a mesma pessoa: dígitos, sem 55 (país) e sem o
// 9 do móvel → DDD+8. Estrangeiro (sem 55) fica como está. (telefone sozinho colide,
// por isso o agrupamento exige também o 1º nome — ver suppressRenovados)
function canonPhone(raw) {
  let d = String(raw || "").replace(/\D/g, "");
  if (d.startsWith("55")) d = d.slice(2);
  if (d.length === 11 && d[2] === "9") d = d.slice(0, 2) + d.slice(3);
  return d;
}
const firstNameKey = (nome) =>
  String(nome || "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/\s+/)[0] || "";
function vencMs(s) {
  const m = String(s || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? new Date(+m[3], +m[2] - 1, +m[1]).getTime() : NaN;
}

/**
 * Esconde a linha ANTIGA (Vencido) de quem RENOVOU. Aluno renovado tem 2+ linhas
 * (1ª vencida + renovação ativa, ambas ficam na mestre). Se a MESMA pessoa (mesmo
 * telefone canônico + mesmo 1º nome — telefone sozinho colide, ex: 7 pessoas no
 * mesmo número) tem uma linha ATIVA com vencimento POSTERIOR, o plano atual está
 * rodando → a vencida velha NÃO aparece nem conta como Vencido. Espelha o
 * planStatus_ do app (prioriza qualquer Ativa). Só mexe em linhas Vencido; Ativo/
 * Cancelado/etc. passam intactos. Sem telefone confiável (<8 díg) não agrupa.
 * Regra GH 2026-06-22 (aluno renovado não pode cair na aba de Vencidos).
 */
function suppressRenovados(objs) {
  const ativos = [];
  for (const s of objs) {
    if (s.statusPlano !== "Ativo") continue;
    const ph = canonPhone(s.contato);
    if (ph.length >= 8) ativos.push({ key: ph + "|" + firstNameKey(s.nome), venc: vencMs(s.dataVencimento) });
  }
  if (!ativos.length) return objs;
  return objs.filter((s) => {
    if (s.statusPlano !== "Vencido") return true;
    const ph = canonPhone(s.contato);
    if (ph.length < 8) return true;
    const key = ph + "|" + firstNameKey(s.nome);
    const myV = vencMs(s.dataVencimento);
    return !ativos.some((a) => a.key === key && (Number.isNaN(myV) || (!Number.isNaN(a.venc) && a.venc > myV)));
  });
}

export async function getStudents() {
  if (!SPREADSHEET_ID) {
    throw new Error("GOOGLE_SHEETS_ID não definido em .env.local");
  }
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: RANGE,
    valueRenderOption: "FORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING",
  });
  const rows = res.data.values || [];
  const objs = rows
    .map((r, i) => ({ row: r, sheetRowNumber: i + 2 }))
    .filter(({ row }) => Array.isArray(row) && row.some((c) => c !== "" && c !== undefined))
    .map(({ row, sheetRowNumber }) => rowToObject(row, sheetRowNumber));
  return suppressRenovados(objs).reverse();
}

// Lê uma aba inteira (sem cabeçalho) da MESMA planilha mestre. Tolera aba
// inexistente (ex: FEEDBACKS antes do 1º registro) retornando [].
async function readTabRows(tabName, lastCol) {
  if (!SPREADSHEET_ID) throw new Error("GOOGLE_SHEETS_ID não definido");
  const sheets = await getSheetsClient();
  let res;
  try {
    res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${tabName}!A2:${lastCol}`,
      valueRenderOption: "FORMATTED_VALUE",
      dateTimeRenderOption: "FORMATTED_STRING",
    });
  } catch (e) {
    if (String(e?.message || e).toLowerCase().includes("unable to parse range")) return [];
    throw e;
  }
  return (res.data.values || []).filter(
    (r) => Array.isArray(r) && r.some((c) => String(c || "").trim() !== "")
  );
}

/**
 * Pedidos de ajuste (AJUSTES_PEDIDOS) + feedbacks (FEEDBACKS) pra aba Suporte
 * do CRM. Read-only. As duas abas vivem na mesma planilha mestre.
 */
export async function getSupportTickets() {
  // AJUSTES_PEDIDOS: A Timestamp | B Status | C Aluno | D SheetId | E Phone |
  //                  F Contexto | G Pedido | H AppliedAt | I Observacao | J Fotos
  const ajRows = await readTabRows("AJUSTES_PEDIDOS", "J");
  const ajustes = ajRows
    .map((r) => ({
      kind: "ajuste",
      timestamp: r[0] || "",
      status: (r[1] || "pending").trim(),
      aluno: r[2] || "",
      sheetId: r[3] || "",
      phone: r[4] || "",
      contexto: r[5] || "",
      mensagem: r[6] || "",
      appliedAt: r[7] || "",
      obs: r[8] || "",
      fotos: r[9] || "",
    }))
    .reverse();

  // FEEDBACKS: A Timestamp | B Aluno | C SheetId | D Tipo | E Mensagem
  const fbRows = await readTabRows("FEEDBACKS", "E");
  const feedbacks = fbRows
    .map((r) => ({
      kind: "feedback",
      timestamp: r[0] || "",
      aluno: r[1] || "",
      sheetId: r[2] || "",
      tipo: r[3] || "",
      mensagem: r[4] || "",
    }))
    .reverse();

  // CHAT_LOGS: A Timestamp | B Aluno | C SheetId | D Pergunta | E Resposta | F Tipo
  // Cap nos 300 mais recentes — o chatbot pode gerar muito volume.
  const clRows = await readTabRows("CHAT_LOGS", "F");
  const chats = clRows
    .map((r) => ({
      kind: "chat",
      timestamp: r[0] || "",
      aluno: r[1] || "",
      sheetId: r[2] || "",
      pergunta: r[3] || "",
      resposta: r[4] || "",
      tipo: r[5] || "",
      mensagem: r[3] || "",
    }))
    .reverse()
    .slice(0, 300);

  return { ajustes, feedbacks, chats };
}

// Match de telefone igual phoneMatches_ do Apps Script: extrai só os dígitos dos
// dois lados e casa se um termina com o outro (mín 8 dígitos). NÃO força o
// prefixo 55 — tem aluno do exterior sem 55.
export function phoneSuffixMatch(a, b) {
  const da = String(a || "").replace(/\D/g, "");
  const db = String(b || "").replace(/\D/g, "");
  if (da.length < 8 || db.length < 8) return false;
  return da.length >= db.length ? da.slice(-db.length) === db : db.slice(-da.length) === da;
}

// Índice 0-based de coluna → letra (0→A, 25→Z, 26→AA). Pra escrever numa coluna
// achada por header (não por letra fixa, que muda quando a planilha cresce).
function colLetter(n) {
  let s = "";
  n = n + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// Data de hoje no fuso BRT, formato DD/MM/YYYY (igual às datas da mestre).
function todayBR() {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit", month: "2-digit", year: "numeric",
  }).format(new Date());
}

/**
 * Notas de perfil dos alunos (aba NOTAS_SUPORTE da planilha mestre).
 * A Telefone (só dígitos) | B Nome | C Perfil/Nota (multilinha, já formatado) |
 * D Atualizado. O texto da col C vai direto no campo de notas do CRM.
 * Tolera a aba não existir ainda (retorna []).
 */
export async function getNotasSuporte() {
  const rows = await readTabRows("NOTAS_SUPORTE", "D");
  return rows
    .map((r) => ({
      digits: String(r[0] || "").replace(/\D/g, ""),
      nome: r[1] || "",
      nota: String(r[2] || "").trim(),
      atualizado: r[3] || "",
    }))
    .filter((n) => n.digits.length >= 8 && n.nota);
}

/**
 * Último treino concluído por aluno (aba LOGS do mestre, escrita pelo app de
 * treino a cada conclusão). C SheetId | D Data Treino (YYYY-MM-DD).
 * Retorna um Map sheetId → "YYYY-MM-DD" (data mais recente).
 */
export async function getLastWorkouts() {
  const rows = await readTabRows("LOGS", "D");
  const map = new Map();
  for (const r of rows) {
    const sid = String(r[2] || "").trim();
    const date = String(r[3] || "").trim();
    if (!sid || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const cur = map.get(sid);
    if (!cur || date > cur) map.set(sid, date);
  }
  return map;
}

/**
 * Adiciona uma linha nova na CONTROLE ALUNOS.
 * Usa append em A:I com os campos essenciais (Nome, Contato, Data Compra,
 * Protocolo Inicial, Protocolo Atual, Versão Atual, Tipo Plano, Hormonal,
 * Valor Plano). Colunas calculadas (J/K/L/M/N/O/Q/T/V/X) ficam vazias
 * pra que ARRAYFORMULAs cubram a nova linha.
 *
 * Depois faz updates separados em P, R, S (Forma Pagamento, CPF, Tags) se
 * vierem preenchidos — mais seguro que sobrescrever a linha toda.
 *
 * @param {object} data
 * @param {string} data.nome              (req)
 * @param {string} data.contato           (req) — só dígitos OK
 * @param {string} data.dataCompra        (req) DD/MM/YYYY
 * @param {string} data.tipoPlano         (req) Anual | Trimestral | Semestral | Mensal
 * @param {string|number} data.valorPlano (req)
 * @param {string} [data.protocoloHormonal] Sim | Não
 * @param {string} [data.formaPagamento]
 * @param {string} [data.cpf]
 * @param {string} [data.tags]
 */
export async function appendStudent(data) {
  if (!SPREADSHEET_ID) throw new Error("GOOGLE_SHEETS_ID não definido");
  // Obrigatórios: SÓ Nome + Telefone. O resto (data, plano, valor, hormonal...)
  // vem depois pela anamnese que o aluno preenche. (regra GH)
  if (!data.nome || !String(data.nome).trim()) {
    throw new Error("Campo obrigatório vazio: nome");
  }
  if (!data.contato || !String(data.contato).trim()) {
    throw new Error("Campo obrigatório vazio: contato (telefone)");
  }

  // Re-autentica com escopo de escrita
  const auth = new (await import("googleapis")).google.auth.GoogleAuth({
    credentials: getCredentials(),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheetsRW = (await import("googleapis")).google.sheets({ version: "v4", auth });
  const tab = TAB || "CONTROLE ALUNOS";

  // Normaliza contato pra URL wa.me (formato esperado pela planilha)
  const digits = String(data.contato).replace(/\D/g, "");
  const contatoUrl = digits ? `https://wa.me/${digits}` : data.contato;

  // Lê A..R uma vez: serve tanto pra DEDUP (telefone B / CPF R) quanto pra achar
  // a última linha (col A). NÃO usar values.append: ele auto-detecta a "tabela" e,
  // se houver fórmula/lixo abaixo dos dados, escreve na linha errada e até desloca
  // a coluna (nome caía na col G). Escrevemos EXPLICITAMENTE na linha seguinte ao
  // último bloco contíguo — robusto a vãos/fórmulas abaixo dos dados.
  const rowsRes = await sheetsRW.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${tab}!A2:R`,
  });
  const rows = rowsRes.data.values || [];

  // IDEMPOTÊNCIA (anti duplo-clique / retry): se já existe linha com o MESMO
  // telefone (sufixo) ou MESMO CPF, NÃO cria outra — devolve a existente. Evita a
  // entrada dupla tipo Guilherme Borotta L869/L870 (#147 da Sala). Renovação é
  // outro fluxo (registrarRenovacao), então aqui telefone repetido = duplicata.
  const cpfNew = String(data.cpf || "").replace(/\D/g, "");
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] || [];
    const nm = String(r[0] || "").trim();
    if (!nm) continue;
    const existePhone = String(r[1] || "").replace(/\D/g, "");
    const existeCpf = String(r[17] || "").replace(/\D/g, "");
    const phoneHit = digits.length >= 8 && existePhone.length >= 8 && phoneSuffixMatch(digits, existePhone);
    const cpfHit = cpfNew.length >= 11 && existeCpf === cpfNew;
    if (phoneHit || cpfHit) {
      return { row: i + 2, contato: contatoUrl, duplicate: true, matchedBy: phoneHit ? "telefone" : "CPF", existingNome: nm };
    }
  }

  let lastData = 1; // linha 1 = cabeçalho
  for (let i = 0; i < rows.length; i++) {
    if (String((rows[i] || [])[0] || "").trim() !== "") {
      lastData = i + 2;
    } else {
      // vão de >=20 linhas vazias seguidas = fim do bloco de dados
      let gap = true;
      for (let k = i; k < i + 20 && k < rows.length; k++) {
        if (String((rows[k] || [])[0] || "").trim() !== "") { gap = false; break; }
      }
      if (gap) break;
    }
  }
  const newRow = lastData + 1;

  // 2. Escreve EXPLICITAMENTE em A..I da linha nova (alinhado, sem auto-detect).
  // Colunas ARRAYFORMULA (J/K/L/M/N/Q/T) ficam INTOCADAS — elas calculam a nova
  // linha sozinhas; cravar valor nelas trava a coluna inteira (K89).
  await sheetsRW.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${tab}!A${newRow}:I${newRow}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[
        data.nome,
        contatoUrl,
        data.dataCompra || "",
        "",                              // D Protocolo inicial — AppScript preenche
        "",                              // E Protocolo atual — idem
        "",                              // F Versão atual — idem
        data.tipoPlano || "",
        data.protocoloHormonal || "Não",   // regra GH: "não adquiriu" por padrão
        (data.valorPlano === 0 || data.valorPlano) ? String(data.valorPlano) : "",
      ]],
    },
  });

  // 3. Carimba SÓ colunas de INPUT, com valor LITERAL. NUNCA toca coluna
  // ARRAYFORMULA (J/K/L/M/N/Q/T) — cravar um valor numa arrayformula trava a
  // coluna INTEIRA (#REF!, incidente K89). Schema real da mestre:
  //  - Peptídeos (T) = ARRAYFORMULA que procura "pept" na coluna S (tags). Pra
  //    marcar peptídeos, adiciona a tag em S — NUNCA escreve T.
  //  - Categoria (V) = input literal → grava o valor direto (Padrão/Black).
  //  - Renovação (X) = fica VAZIA no aluno novo (1ª compra); X=RENOVACAO vem só
  //    pelo endpoint registrarRenovacao da Mestre (fluxo de renovação).
  const tagsBase = String(data.tags || "").trim();
  const peptTag = data.peptideos === "Sim" ? "peptideos" : ""; // T procura "pept" em S
  const tagsFinal = [tagsBase, peptTag].filter(Boolean).join(", ");

  const updates = [
    { range: `${tab}!V${newRow}`, values: [[data.categoria === "Black" ? "Black" : "Padrão"]] },
  ];
  // Opcionais (P/R) só se vierem preenchidos. S leva as tags + a de peptídeos.
  if (data.formaPagamento) updates.push({ range: `${tab}!P${newRow}`, values: [[data.formaPagamento]] });
  if (data.cpf) updates.push({ range: `${tab}!R${newRow}`, values: [[data.cpf]] });
  if (tagsFinal) updates.push({ range: `${tab}!S${newRow}`, values: [[tagsFinal]] });

  await sheetsRW.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { valueInputOption: "USER_ENTERED", data: updates },
  });

  return { row: newRow, contato: contatoUrl };
}

function getCredentials() {
  if (process.env.GOOGLE_CREDENTIALS_JSON) return JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
  const private_key = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  return {
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    private_key,
    project_id: process.env.GOOGLE_PROJECT_ID,
  };
}

// Mapeamento campo → letra da coluna na planilha. Só campos editáveis aqui.
// Bloqueados: nome (A), contato (B), protocoloInicial (D), protocoloAtual (E),
// versaoAtual (F) — esses são chave ou controlados pelo AppScript.
// Calculadas (não fazem sentido editar): J, K, L, N, Q.
export const EDITABLE_FIELDS = {
  dataCompra:         "C",
  tipoPlano:          "G",
  protocoloHormonal:  "H",
  valorPlano:         "I",
  proximoReajuste:    "M",
  dataPagamento:      "O",
  formaPagamento:     "P",
  cpf:                "R",
  tags:               "S",
  peptideos:          "T",
  mesesExtras:        "U",
  categoria:          "V",
  linkSite:           "W",
};

/**
 * Atualiza células específicas de uma linha de aluno na CONTROLE ALUNOS.
 * Aceita um objeto parcial — só campos em EDITABLE_FIELDS são gravados,
 * o resto é ignorado silenciosamente.
 *
 * @param {number} rowNumber — número 1-based da linha na planilha (vem de _rowIndex)
 * @param {object} partial — { campo: novoValor }
 */
export async function updateStudent(rowNumber, partial) {
  if (!Number.isInteger(rowNumber) || rowNumber < 2) {
    throw new Error("rowNumber inválido");
  }
  if (!SPREADSHEET_ID) throw new Error("GOOGLE_SHEETS_ID não definido");
  const tab = TAB || "CONTROLE ALUNOS";

  const updates = [];
  const fieldsApplied = [];
  for (const [key, value] of Object.entries(partial || {})) {
    const col = EDITABLE_FIELDS[key];
    if (!col) continue;
    updates.push({
      range: `${tab}!${col}${rowNumber}`,
      values: [[value === null || value === undefined ? "" : String(value)]],
    });
    fieldsApplied.push(key);
  }

  if (updates.length === 0) return { updated: 0, fields: [] };

  const { google } = await import("googleapis");
  const auth = new google.auth.GoogleAuth({
    credentials: getCredentials(),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheetsRW = google.sheets({ version: "v4", auth });
  await sheetsRW.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { valueInputOption: "USER_ENTERED", data: updates },
  });

  return { updated: updates.length, fields: fieldsApplied };
}

/**
 * Exclui a linha do aluno na mestre (deleteDimension — remove a linha inteira).
 * Segurança: confere que a linha AINDA é o aluno esperado (por nome) antes de
 * apagar, pra não remover a linha errada caso a tabela tenha mudado entre a
 * leitura do CRM e o clique no botão.
 */
export async function deleteStudent(rowNumber, expectedName) {
  if (!SPREADSHEET_ID) throw new Error("GOOGLE_SHEETS_ID não definido");
  if (!Number.isInteger(rowNumber) || rowNumber < 2) throw new Error("row inválido");

  const auth = new (await import("googleapis")).google.auth.GoogleAuth({
    credentials: getCredentials(),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheetsRW = (await import("googleapis")).google.sheets({ version: "v4", auth });
  const tab = TAB || "CONTROLE ALUNOS";

  // 1. Confere o nome atual da linha (proteção contra deslocamento de linha)
  const cur = await sheetsRW.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${tab}!A${rowNumber}:B${rowNumber}`,
  });
  const curNome = String(cur.data.values?.[0]?.[0] || "").trim();
  if (!curNome) throw new Error("a linha já está vazia");
  if (expectedName != null && String(expectedName).trim() !== "") {
    const norm = (s) => String(s).trim().toLowerCase();
    if (norm(curNome) !== norm(expectedName)) {
      const e = new Error(`a linha mudou (esperava "${expectedName}", achei "${curNome}"). Atualize a lista e tente de novo.`);
      e.code = "ROW_MISMATCH";
      throw e;
    }
  }

  // 2. Descobre o gid (sheetId numérico) da aba
  const meta = await sheetsRW.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
    fields: "sheets(properties(title,sheetId))",
  });
  const sheet = (meta.data.sheets || []).find((s) => s.properties.title === tab);
  if (!sheet) throw new Error(`aba "${tab}" não encontrada`);
  const gid = sheet.properties.sheetId;

  // 3. Deleta a linha inteira (startIndex 0-based = rowNumber - 1)
  await sheetsRW.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [{
        deleteDimension: {
          range: { sheetId: gid, dimension: "ROWS", startIndex: rowNumber - 1, endIndex: rowNumber },
        },
      }],
    },
  });

  return { row: rowNumber, deletedName: curNome };
}

/**
 * Cancela (ou reativa) o plano do aluno escrevendo SÓ a coluna-input
 * "Cancelado em" da mestre — o switch de cancelamento (contrato #151 da Sala).
 * A col K (status) é fórmula da Mestre e emite "Cancelado" quando essa data está
 * preenchida; o app bloqueia via planStatus_. NUNCA toca coluna-fórmula.
 * Acha a coluna pelo HEADER (linha 1), não por letra fixa — robusto a posição.
 * Reversível: uncancel limpa a data (K volta a Ativo/Vencido por data).
 *
 * @param {number} rowNumber 1-based (vem de _rowIndex)
 * @param {string} expectedName proteção contra deslocamento de linha
 * @param {object} [opts] { uncancel:boolean }
 */
export async function cancelStudent(rowNumber, expectedName, { uncancel = false } = {}) {
  if (!SPREADSHEET_ID) throw new Error("GOOGLE_SHEETS_ID não definido");
  if (!Number.isInteger(rowNumber) || rowNumber < 2) throw new Error("row inválido");

  const { google } = await import("googleapis");
  const auth = new google.auth.GoogleAuth({
    credentials: getCredentials(),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheetsRW = google.sheets({ version: "v4", auth });
  const tab = TAB || "CONTROLE ALUNOS";
  const norm = (s) => String(s || "").trim().toLowerCase();

  // 1. Acha a coluna "Cancelado em" pelo HEADER (nunca letra fixa). Casa por
  //    "cancelad" (cobre "Cancelado em" / "Cancelamento"). Nenhuma coluna-fórmula
  //    da mestre tem isso no header, então não há risco de cravar numa arrayformula.
  const headerRes = await sheetsRW.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${tab}!1:1`,
  });
  const headers = (headerRes.data.values || [])[0] || [];
  const colIdx = headers.findIndex((h) => norm(h).includes("cancelad"));
  if (colIdx < 0) {
    const e = new Error('a coluna "Cancelado em" ainda não existe na mestre — a Mestre precisa criar antes de cancelar pelo CRM.');
    e.code = "NO_CANCEL_COLUMN";
    throw e;
  }
  const col = colLetter(colIdx);

  // 2. Segurança: confere o nome atual da linha (proteção contra deslocamento).
  const cur = await sheetsRW.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${tab}!A${rowNumber}`,
  });
  const curNome = String(cur.data.values?.[0]?.[0] || "").trim();
  if (!curNome) throw new Error("a linha está vazia");
  if (expectedName != null && String(expectedName).trim() !== "" && norm(curNome) !== norm(expectedName)) {
    const e = new Error(`a linha mudou (esperava "${expectedName}", achei "${curNome}"). Atualize a lista e tente de novo.`);
    e.code = "ROW_MISMATCH";
    throw e;
  }

  // 3. Escreve SÓ essa coluna-input. Cancelar = data de hoje; reativar = vazio.
  const value = uncancel ? "" : todayBR();
  await sheetsRW.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${tab}!${col}${rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[value]] },
  });

  return { row: rowNumber, nome: curNome, col, cancelado: !uncancel, data: value };
}

/**
 * Pausa (ou retoma) o plano do aluno — congelamento por viagem/acidente etc.
 * Contrato #201/#203 da Sala. Escreve SÓ colunas-input da mestre, NUNCA fórmula:
 *  - PAUSAR: "Pausado em" (Z) = hoje. A col K (fórmula da Mestre) emite "Pausado"
 *    (vence a data) → o app bloqueia.
 *  - RETOMAR: credita os dias parados em "Dias extras" (AA): AA_novo = AA_atual +
 *    (hoje − Pausado em), e limpa "Pausado em". O vencimento (J=EDATE+U+AA dias)
 *    estende exatamente pelos dias parados. Acumula em múltiplas pausas.
 * Acha as colunas por HEADER: "pausad" (Z, único) e "dias extra" (AA) — NÃO casar
 * por "extra"/"extras" sozinho (U="Meses extras" colidiria, aviso da Mestre #203).
 * Reversível, não apaga nada.
 */
export async function pauseStudent(rowNumber, expectedName, { resume = false } = {}) {
  if (!SPREADSHEET_ID) throw new Error("GOOGLE_SHEETS_ID não definido");
  if (!Number.isInteger(rowNumber) || rowNumber < 2) throw new Error("row inválido");

  const { google } = await import("googleapis");
  const auth = new google.auth.GoogleAuth({
    credentials: getCredentials(),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheetsRW = google.sheets({ version: "v4", auth });
  const tab = TAB || "CONTROLE ALUNOS";
  const norm = (s) => String(s || "").trim().toLowerCase();

  // 1. Colunas por header. "pausad" = Pausado em (único). "dias extra" = Dias extras
  //    (NÃO usar só "extra"/"extras" — U="Meses extras" colidiria).
  const headers = ((await sheetsRW.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `${tab}!1:1` })).data.values || [])[0] || [];
  const idxPaus = headers.findIndex((h) => norm(h).includes("pausad"));
  const idxDias = headers.findIndex((h) => norm(h).includes("dias extra"));
  if (idxPaus < 0 || idxDias < 0) {
    const e = new Error('as colunas "Pausado em" / "Dias extras" ainda não existem na mestre — a Mestre precisa criar antes de pausar pelo CRM.');
    e.code = "NO_PAUSE_COLUMN";
    throw e;
  }
  const colPaus = colLetter(idxPaus);
  const colDias = colLetter(idxDias);

  // 2. Lê nome (segurança) + Pausado em + Dias extras atuais.
  const got = await sheetsRW.spreadsheets.values.batchGet({
    spreadsheetId: SPREADSHEET_ID,
    ranges: [`${tab}!A${rowNumber}`, `${tab}!${colPaus}${rowNumber}`, `${tab}!${colDias}${rowNumber}`],
  });
  const [nameR, pausR, diasR] = got.data.valueRanges.map((v) => ((v.values || [])[0] || [])[0] || "");
  const curNome = String(nameR).trim();
  if (!curNome) throw new Error("a linha está vazia");
  if (expectedName != null && String(expectedName).trim() !== "" && norm(curNome) !== norm(expectedName)) {
    const e = new Error(`a linha mudou (esperava "${expectedName}", achei "${curNome}"). Atualize a lista e tente de novo.`);
    e.code = "ROW_MISMATCH";
    throw e;
  }

  if (resume) {
    // RETOMAR: credita os dias parados + limpa Pausado em.
    if (!String(pausR).trim()) {
      const e = new Error("o aluno não está pausado (sem data em 'Pausado em').");
      e.code = "NOT_PAUSED";
      throw e;
    }
    const pausMs = vencMs(pausR);
    const hojeMs = vencMs(todayBR());
    const diasParados = Number.isNaN(pausMs) || Number.isNaN(hojeMs) ? 0 : Math.max(0, Math.round((hojeMs - pausMs) / 86400000));
    const aaAtual = parseInt(String(diasR).replace(/[^\d-]/g, ""), 10) || 0;
    const novoAA = aaAtual + diasParados;
    await sheetsRW.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        valueInputOption: "USER_ENTERED",
        data: [
          { range: `${tab}!${colDias}${rowNumber}`, values: [[String(novoAA)]] },
          { range: `${tab}!${colPaus}${rowNumber}`, values: [[""]] },
        ],
      },
    });
    return { row: rowNumber, nome: curNome, paused: false, diasCreditados: diasParados, diasExtrasTotal: novoAA };
  }

  // PAUSAR: marca Pausado em = hoje (guarda contra re-pausar, pra não perder a data origem).
  if (String(pausR).trim()) {
    const e = new Error("o aluno já está pausado.");
    e.code = "ALREADY_PAUSED";
    throw e;
  }
  await sheetsRW.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${tab}!${colPaus}${rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[todayBR()]] },
  });
  return { row: rowNumber, nome: curNome, paused: true, desde: todayBR() };
}
