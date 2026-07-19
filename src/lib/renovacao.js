// Renovação via Apps Script — a planilha MESTRE é dona da lógica (handshake Sala #104).
// SERVER-SIDE só: o Apps Script responde com 302 redirect e sem header de CORS,
// então fetch client-side quebra. Estes 2 endpoints são o caminho abençoado:
//   - alunoConsolidado: fonte de verdade, agrupa as linhas duplicadas (pré-preenche o form)
//   - registrarRenovacao: cria a linha nova "nascendo certa" — idempotente (1x/dia),
//     link (W) na linha ATIVA, carrega a versão ATUAL em F (continuidade, sem bump
//     automático pro teto), X=RENOVACAO, e NUNCA crava coluna-fórmula.
//
// BASE/TOKEN não são segredo (é o mesmo exec público já usado no publish), mas
// ficam server-only por higiene. Configuráveis por env; default = canônico.

const BASE = process.env.MESTRE_APPS_SCRIPT_URL
  || "https://script.google.com/macros/s/AKfycby0Kej7V7Gi2gIDKorBookSLofBMHOF50UFWq4Q1fTmstCD8ed8O9XLyCaZo8QIeUPfeQ/exec";
const TOKEN = process.env.MESTRE_RENOVACAO_TOKEN || "timegh";

const onlyDigits = (v) => String(v == null ? "" : v).replace(/\D/g, "");

// nkey igual ao do .gs (alunoConsolidado_): minúsculo, sem acento, espaços normalizados.
const nkey = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

/**
 * TRAVA DE HOMÔNIMO (Sala #820/#821). O alunoConsolidado_ do .gs agrupa as linhas do
 * aluno por CPF **ou pelo NOME normalizado** (ele semeia pelo cpf/telefone e depois
 * coleta todas as linhas de mesmo nome). Isso é proposital pra renovação (o mesmo
 * aluno tem várias linhas, às vezes sem CPF), mas com DOIS alunos diferentes de mesmo
 * nome ele mistura os dois — foi o caso dos dois "Leandro Oliveira" ativos (L713/L963),
 * que fez o protocolo de um quase cair na planilha viva do outro.
 *
 * A Site consertou o createSheetForStudent_, mas o alunoConsolidado_ (que é quem
 * alimenta ESTE botão) ainda casa por nome. Então aqui, ANTES de renovar, eu olho a
 * mestre e vejo se o nome é ambíguo. Critério = o mesmo que a Site adotou: mesma
 * pessoa se o TELEFONE casa; telefone diferente = homônimo. Renovação (várias linhas
 * do mesmo telefone) NÃO dispara.
 *
 * @returns null se o nome é único, ou { nome, pessoas:[{telefone,linhas,status}] }
 */
export async function checarHomonimo({ nome } = {}) {
  const alvo = nkey(nome);
  if (!alvo) return null;
  const { getStudents } = await import("./sheets");
  const mesmoNome = (await getStudents()).filter((s) => nkey(s.nome) === alvo);
  if (mesmoNome.length < 2) return null;
  // agrupa por telefone (8 últimos dígitos, tolerante ao 9º dígito e ao DDI)
  const porTelefone = new Map();
  for (const s of mesmoNome) {
    const d = onlyDigits(s.contato);
    const k = d ? d.slice(-8) : "(sem telefone)";
    if (!porTelefone.has(k)) porTelefone.set(k, { telefone: d, linhas: [], status: new Set() });
    const g = porTelefone.get(k);
    g.linhas.push(s._rowIndex);
    if (s.statusPlano) g.status.add(s.statusPlano);
  }
  if (porTelefone.size < 2) return null; // mesma pessoa (renovação gera várias linhas)
  return {
    nome: mesmoNome[0].nome,
    pessoas: [...porTelefone.values()].map((g) => ({
      telefone: g.telefone,
      linhas: g.linhas.sort((a, b) => a - b),
      status: [...g.status].join("/") || "—",
    })),
  };
}

async function callMestre(params) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${BASE}?${qs}`, {
    method: "GET",
    redirect: "follow", // 302 do Apps Script -> googleusercontent
    headers: { accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(30000),
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`resposta não-JSON da mestre (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }
}

/**
 * Estado consolidado do aluno (pré-preenche o form de renovação).
 * Agrupa linhas duplicadas e devolve o ciclo atual. cpf OU phone.
 * Retorna { ok, found, nome, cpf, telefone, plano, valor, status, vencimento,
 *           hormonal, peptideos, categoria, versaoAtual, proximaVersao, sheetId,
 *           link, linkOk, linhas, linhaAtual, historico:[...] } | { ok, found:false }
 */
export async function getAlunoConsolidado({ cpf, phone } = {}) {
  const c = onlyDigits(cpf);
  const p = onlyDigits(phone);
  if (!c && !p) throw new Error("informe cpf ou telefone");
  // Manda os DOIS quando existirem (regra da Mestre, Sala #776): o _consolida_ casa
  // por CPF válido OU telefone, e 72 dos ~500 ativos têm CPF vazio/inválido (os mais
  // recentes). Mandar só um deixa esses de fora; mandar os dois cobre todo mundo.
  return callMestre({ action: "alunoConsolidado", ...(c ? { cpf: c } : {}), ...(p ? { phone: p } : {}) });
}

/**
 * Registra a renovação na mestre. cpf OU phone obrigatório; os demais campos
 * herdam do último ciclo se não vierem. Idempotente no dia.
 * Sucesso: { ok:true, linha, nome, versao, proximaVersao, linkOk }
 * Já hoje: { ok:true, duplicate:true, aviso:"ja havia renovacao registrada hoje" }
 * Erro:    { ok:false, error:"aluno nao encontrado..." }
 */
export async function registrarRenovacao(data = {}) {
  const c = onlyDigits(data.cpf);
  const p = onlyDigits(data.phone || data.contato);
  if (!c && !p) throw new Error("informe cpf ou telefone");
  // cpf E phone juntos (Sala #776) — ver comentário em getAlunoConsolidado.
  const params = { action: "registrarRenovacao", token: TOKEN, ...(c ? { cpf: c } : {}), ...(p ? { phone: p } : {}) };
  // só manda o que veio preenchido (o resto herda do ciclo anterior na mestre)
  const opt = {
    plano: data.plano,
    valor: data.valor,
    forma: data.forma || data.formaPagamento,
    hormonal: data.hormonal || data.protocoloHormonal,
    peptideos: data.peptideos,
    categoria: data.categoria,
  };
  for (const [k, v] of Object.entries(opt)) {
    if (v != null && String(v).trim() !== "") params[k] = String(v).trim();
  }
  return callMestre(params);
}
