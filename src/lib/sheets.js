import { google } from "googleapis";

const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID;
const TAB = process.env.GOOGLE_SHEETS_TAB || ""; // vazio = primeira aba
const RANGE = TAB ? `${TAB}!A2:W` : "A2:W";

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
  return rows
    .map((r, i) => ({ row: r, sheetRowNumber: i + 2 }))
    .filter(({ row }) => Array.isArray(row) && row.some((c) => c !== "" && c !== undefined))
    .map(({ row, sheetRowNumber }) => rowToObject(row, sheetRowNumber))
    .reverse();
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

  // 1. Acha a ÚLTIMA LINHA REAL pela coluna A (nome).
  // NÃO usar values.append: ele auto-detecta a "tabela" (linha E coluna
  // iniciais) e, se houver fórmula/lixo abaixo dos dados, escreve na linha
  // errada e até desloca a coluna (nome caía na col G). Aqui lemos a col A e
  // escrevemos EXPLICITAMENTE em A..I da linha seguinte ao último bloco
  // contíguo — robusto a vãos/fórmulas abaixo dos dados.
  const colARes = await sheetsRW.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${tab}!A2:A`,
  });
  const colA = colARes.data.values || [];
  let lastData = 1; // linha 1 = cabeçalho
  for (let i = 0; i < colA.length; i++) {
    if (String((colA[i] || [])[0] || "").trim() !== "") {
      lastData = i + 2;
    } else {
      // vão de >=20 linhas vazias seguidas = fim do bloco de dados
      let gap = true;
      for (let k = i; k < i + 20 && k < colA.length; k++) {
        if (String((colA[k] || [])[0] || "").trim() !== "") { gap = false; break; }
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
