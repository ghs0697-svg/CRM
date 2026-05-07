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
  // subscriberId do ManyChat: sempre prefere o mais recente (subscriber pode
  // ser recriado, e usar o antigo causaria erro 404 quando o CRM chamasse o
  // ManyChat de volta no vencimento).
  if (incoming.subscriberId) {
    existing.subscriberId = incoming.subscriberId;
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
 * Marca um follow-up específico (aluno + tag) como disparado pelo cron.
 * Usado depois que o ManyChat aceita o sendFlow — pra não disparar de novo
 * no próximo ciclo.
 *
 * Retorna true se atualizou, false se não achou aluno/tag.
 */
export async function markFollowUpFired(phone, tag, firedAt) {
  const phoneKey = (s) => String(s || "").replace(/\D/g, "").slice(-10);
  const target = phoneKey(phone);
  if (target.length < 8) return false;
  const list = useKV ? await readKV() : await readFS();
  const idx = list.findIndex((s) => phoneKey(s.phone) === target);
  if (idx === -1) return false;
  const student = list[idx];
  let changed = false;
  student.followUps = (student.followUps || []).map((fu) => {
    if (fu.tag === tag && !fu.firedAt) {
      changed = true;
      return { ...fu, firedAt };
    }
    return fu;
  });
  if (changed) {
    list[idx] = student;
    if (useKV) await writeKV(list);
    else await writeFS(list);
  }
  return changed;
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
 *   { id, name, phone, subscriberId, assignmentDate, seller, observations,
 *     followUps: [{tag, status, outcome, calledAt, firedAt}] }
 *
 * firedAt: ISO date (YYYY-MM-DD) de quando o cron disparou o follow-up
 * via API do ManyChat. null enquanto não disparou. Usado pra:
 *   - evitar disparo duplicado no próximo ciclo do cron
 *   - mostrar badge "Mensagem enviada {{data}}" no card
 *
 * Formatos de payload aceitos:
 *
 *   NOVO (1 tag genérica + custom field numérico no ManyChat):
 *     { name, phone, subscriber_id, dias: 17 }
 *     → cria 1 follow-up com tag "17 dias" vencendo hoje + 17 dias.
 *
 *   LEGADO (4 tags fixas — mantido pra compat):
 *     { name, phone, tag: "7 dias" }
 *     { name, phone, tags: ["3 dias", "15 dias"] }
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

  // ManyChat subscriber ID — usado pra chamar de volta a API do ManyChat
  // quando vencer o follow-up. Variável "ID do contato" no ManyChat PT-BR
  // resolve pro mesmo valor que User ID em EN.
  const subscriberId =
    String(
      payload.subscriber_id ||
        payload.subscriberId ||
        payload["ID do contato"] ||
        payload.user_id ||
        ""
    ).trim() || null;

  // Helper: monta tag string com plural correto.
  const tagFromDays = (n) => `${n} ${n === 1 ? "dia" : "dias"}`;
  const MIN_DAYS = 1;
  const MAX_DAYS = 365;

  let followUps = [];

  // Novo formato: "dias" como número (custom field numérico do ManyChat).
  // Ex: { dias: 17 } → follow-up vencendo em 17 dias.
  const rawDias =
    payload.dias ??
    payload.days ??
    payload["Follow-up"] ??
    payload["Agendar follow"];
  const diasMatch =
    rawDias != null && String(rawDias).trim() !== ""
      ? String(rawDias).match(/\d+/)
      : null;
  const diasNum = diasMatch ? parseInt(diasMatch[0], 10) : NaN;

  if (Number.isFinite(diasNum) && diasNum >= MIN_DAYS && diasNum <= MAX_DAYS) {
    followUps = [
      {
        tag: tagFromDays(diasNum),
        status: "pendente",
        outcome: null,
        calledAt: null,
        firedAt: null,
      },
    ];
  } else {
    // Legado: parseia "tag"/"tags" strings ("3 dias", "7 dias" etc).
    // Aceita: tag (singular), tags (plural array OU string separada por vírgula).
    const rawTags =
      payload.tags ?? payload.tag ?? payload["Tag de Tempo"] ?? payload.time_tag ?? "";
    const list = Array.isArray(rawTags) ? rawTags : String(rawTags).split(/[,;]/);

    followUps = list
      .map((t) => {
        const m = String(t).match(/\d+/);
        return m ? parseInt(m[0], 10) : null;
      })
      .filter((n) => Number.isFinite(n) && n >= MIN_DAYS && n <= MAX_DAYS)
      // remove duplicatas mantendo ordem
      .filter((n, i, arr) => arr.indexOf(n) === i)
      .sort((a, b) => a - b)
      .map((n) => ({
        tag: tagFromDays(n),
        status: "pendente",
        outcome: null,
        calledAt: null,
        firedAt: null,
      }));
  }

  // Fallback se nada válido veio
  if (followUps.length === 0) {
    followUps.push({
      tag: "7 dias",
      status: "pendente",
      outcome: null,
      calledAt: null,
      firedAt: null,
    });
  }

  return {
    id: Date.now() + Math.floor(Math.random() * 1000),
    name: name.trim(),
    phone,
    subscriberId,
    assignmentDate: isoToday,
    seller: payload.seller || "Sem vendedor",
    observations: payload.observations || payload.obs || "",
    followUps,
    source: "manychat",
  };
}
