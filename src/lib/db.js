/**
 * Storage abstraction.
 *
 * Auto-switch:
 *   - Se as env vars KV_REST_API_URL/KV_REST_API_TOKEN existirem (Vercel KV),
 *     usa Redis (Vercel KV ou Upstash) — funciona em produção serverless.
 *   - Senão, grava em database.json na raiz (dev local).
 *
 * O frontend e o webhook só importam getStudents() / addStudent() — a troca
 * fica restrita a este arquivo.
 */
import { promises as fs } from "fs";
import path from "path";

const DB_FILE = path.join(process.cwd(), "database.json");
const KV_KEY = "crm:students";
const useKV = !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);

// Lazy import — só carrega @vercel/kv se vai usar (evita peso no dev local)
let kvLib = null;
async function getKV() {
  if (kvLib) return kvLib;
  const mod = await import("@vercel/kv");
  kvLib = mod.kv;
  return kvLib;
}

async function readKV() {
  const kv = await getKV();
  const v = await kv.get(KV_KEY);
  return Array.isArray(v) ? v : [];
}

async function writeKV(students) {
  const kv = await getKV();
  await kv.set(KV_KEY, students);
}

async function readFS() {
  try {
    const raw = await fs.readFile(DB_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.students) ? parsed.students : [];
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

async function writeFS(students) {
  await fs.writeFile(DB_FILE, JSON.stringify({ students }, null, 2), "utf8");
}

export async function getStudents() {
  return useKV ? readKV() : readFS();
}

/**
 * Adiciona aluno OU faz merge se já existir um com mesmo telefone.
 * - Match por telefone (suffix de 10+ dígitos pra ser tolerante a DDI/máscara)
 * - Se match: mantém aluno existente e só adiciona follow-ups novos (não duplica tags)
 * - Se não match: insere no topo da lista
 *
 * Retorna { student, created: true|false } pra UI saber o que aconteceu.
 */
export async function upsertStudent(incoming) {
  const list = useKV ? await readKV() : await readFS();
  const phoneKey = (s) => String(s || "").replace(/\D/g, "").slice(-10);
  const incomingKey = phoneKey(incoming.phone);

  let existingIdx = -1;
  if (incomingKey.length >= 8) {
    existingIdx = list.findIndex((s) => phoneKey(s.phone) === incomingKey);
  }

  if (existingIdx === -1) {
    // Novo aluno
    list.unshift(incoming);
    if (useKV) await writeKV(list);
    else await writeFS(list);
    return { student: incoming, created: true };
  }

  // Aluno existe → SUBSTITUI follow-ups pendentes pelos novos.
  // Mantém follow-ups concluídos (status != "pendente") como histórico.
  // Regra: cada aluno tem só 1 tag pendente por vez. Se vendedor aplicar
  // tag diferente (ex: aluno mudou de ideia "me chama em 15 dias"), a tag
  // antiga pendente é descartada — ele é chamado conforme a vontade atual.
  const existing = list[existingIdx];
  const concluded = (existing.followUps || []).filter(
    (f) => f.status && f.status !== "pendente"
  );
  const newPending = incoming.followUps || [];

  // Se o webhook chegou com a MESMA tag que já tá pendente, idempotente:
  // mantém a existente (preserva calledAt:null original e qualquer obs lá).
  const existingPending = (existing.followUps || []).filter(
    (f) => !f.status || f.status === "pendente"
  );
  const incomingTags = new Set(newPending.map((f) => f.tag));
  const samePending = existingPending.filter((f) => incomingTags.has(f.tag));
  const incomingNew = newPending.filter(
    (f) => !existingPending.some((e) => e.tag === f.tag)
  );

  existing.followUps = [...concluded, ...samePending, ...incomingNew];

  // Atualiza obs/seller se vieram preenchidos (sem destruir o existente)
  if (incoming.observations && !existing.observations) {
    existing.observations = incoming.observations;
  }
  if (incoming.seller && existing.seller === "Sem vendedor") {
    existing.seller = incoming.seller;
  }
  list[existingIdx] = existing;
  if (useKV) await writeKV(list);
  else await writeFS(list);
  return { student: existing, created: false };
}

// Mantido pra compat — chama upsertStudent
export async function addStudent(student) {
  const { student: s } = await upsertStudent(student);
  return s;
}

/** Apaga TUDO do storage (FS ou KV). Use com token na rota DELETE. */
export async function clearAll() {
  if (useKV) {
    const kv = await getKV();
    await kv.del(KV_KEY);
  } else {
    await writeFS([]);
  }
}

/**
 * Apaga aluno cujo phone bate (suffix de 10 dígitos).
 * Retorna número de alunos removidos.
 */
export async function deleteStudentByPhone(phone) {
  const phoneKey = (s) => String(s || "").replace(/\D/g, "").slice(-10);
  const target = phoneKey(phone);
  if (target.length < 8) return 0;
  const list = useKV ? await readKV() : await readFS();
  const filtered = list.filter((s) => phoneKey(s.phone) !== target);
  const removed = list.length - filtered.length;
  if (removed > 0) {
    if (useKV) await writeKV(filtered);
    else await writeFS(filtered);
  }
  return removed;
}

/**
 * Normaliza payload do ManyChat → formato interno do CRM.
 * O page.js espera:
 *   { id, name, phone, assignmentDate, seller, observations, followUps: [{tag, status, outcome, calledAt}] }
 */
export function buildStudentFromWebhook(payload) {
  const onlyDigits = (s) => String(s || "").replace(/\D/g, "");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const isoToday = today.toISOString().split("T")[0];

  const name =
    payload.name ||
    payload["Nome Completo"] ||
    payload.full_name ||
    payload.fullName ||
    "";
  const phone = onlyDigits(
    payload.phone || payload["Telefone"] || payload.whatsapp || ""
  );

  // Aceita: tag (singular), tags (plural array OU string separada por vírgula).
  // Exemplos válidos:
  //   "tag": "7 dias"
  //   "tag": "7"
  //   "tags": ["3 dias", "7 dias", "15 dias", "30 dias"]
  //   "tags": "3,7,15,30"
  //   "tags": "3 dias, 7 dias"
  const rawTags =
    payload.tags ??
    payload.tag ??
    payload["Tag de Tempo"] ??
    payload.time_tag ??
    "7 dias";

  const ALLOWED_DAYS = [3, 7, 15, 30];
  const list = Array.isArray(rawTags)
    ? rawTags
    : String(rawTags).split(/[,;]/);

  const followUps = list
    .map((t) => {
      const m = String(t).match(/\d+/);
      return m ? parseInt(m[0], 10) : null;
    })
    .filter((n) => ALLOWED_DAYS.includes(n))
    // remove duplicatas mantendo ordem (3 < 7 < 15 < 30)
    .filter((n, i, arr) => arr.indexOf(n) === i)
    .sort((a, b) => a - b)
    .map((n) => ({
      tag: `${n} dias`,
      status: "pendente",
      outcome: null,
      calledAt: null,
    }));

  // Fallback se nada válido veio
  if (followUps.length === 0) {
    followUps.push({
      tag: "7 dias",
      status: "pendente",
      outcome: null,
      calledAt: null,
    });
  }

  return {
    id: Date.now() + Math.floor(Math.random() * 1000),
    name: name.trim(),
    phone,
    assignmentDate: isoToday,
    seller: payload.seller || "Sem vendedor",
    observations: payload.observations || payload.obs || "",
    followUps,
    source: "manychat",
  };
}
