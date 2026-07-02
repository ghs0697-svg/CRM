/**
 * Estado "resolvido" dos itens do /suporte — storage PRÓPRIO do CRM.
 *
 * IMPORTANTE (lane): isto NÃO escreve nas abas AJUSTES_PEDIDOS/FEEDBACKS/CHAT_LOGS
 * da mestre (o fluxo delas é de outras conversas). É só triagem visual do GH no
 * painel: marcar "já vi / já tratei" sem mexer no dado de origem.
 *
 * Storage igual ao db.js: Vercel KV em produção, arquivo JSON no dev local.
 * Formato: { [itemKey]: { em: "YYYY-MM-DDTHH:mm:ssZ" } }
 * itemKey = `${kind}|${timestamp}|${sheetId||aluno}` (estável entre fetches;
 * timestamp cru da planilha + sheetId identificam a linha).
 */
import { promises as fs } from "fs";
import path from "path";

const FS_FILE = path.join(process.cwd(), "suporte-status.json");
const KV_KEY = "crm:suporte:resolvidos";
const useKV = !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);

let kvLib = null;
async function getKV() {
  if (kvLib) return kvLib;
  const mod = await import("@vercel/kv");
  kvLib = mod.kv;
  return kvLib;
}

async function readMap() {
  if (useKV) {
    const kv = await getKV();
    const v = await kv.get(KV_KEY);
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  }
  try {
    const raw = await fs.readFile(FS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (err) {
    if (err.code === "ENOENT") return {};
    throw err;
  }
}

async function writeMap(map) {
  if (useKV) {
    const kv = await getKV();
    await kv.set(KV_KEY, map);
  } else {
    await fs.writeFile(FS_FILE, JSON.stringify(map, null, 2), "utf8");
  }
}

export function itemKey(it) {
  return `${it.kind}|${it.timestamp}|${it.sheetId || it.aluno || ""}`;
}

export async function getResolvidos() {
  return readMap();
}

export async function setResolvido(key, resolved) {
  const k = String(key || "").trim();
  if (!k || k.length > 300) throw new Error("key inválida");
  const map = await readMap();
  if (resolved) map[k] = { em: new Date().toISOString() };
  else delete map[k];
  await writeMap(map);
  return map;
}
