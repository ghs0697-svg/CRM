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

export async function addStudent(student) {
  const list = useKV ? await readKV() : await readFS();
  list.unshift(student);
  if (useKV) await writeKV(list);
  else await writeFS(list);
  return student;
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
  const tagRaw =
    payload.tag || payload["Tag de Tempo"] || payload.time_tag || "7 dias";

  const tagDigits = String(tagRaw).match(/\d+/);
  const tag = tagDigits ? `${tagDigits[0]} dias` : "7 dias";

  return {
    id: Date.now() + Math.floor(Math.random() * 1000),
    name: name.trim(),
    phone,
    assignmentDate: isoToday,
    seller: payload.seller || "Sem vendedor",
    observations: payload.observations || payload.obs || "",
    followUps: [
      { tag, status: "pendente", outcome: null, calledAt: null },
    ],
    source: "manychat",
  };
}
