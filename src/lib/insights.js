// Lê data/insights.json (gerado pelo agente de análise de conversas) e
// indexa por chave normalizada do telefone brasileiro.
//
// Por que precisa normalizar: a planilha mestre guarda números no formato
// 5562996866457 (13 dígitos, com DDI + 9 mobile), enquanto o gh-observer
// VPS recebe do Z-API/ManyChat sem o 9 mobile (556296866457 = 12 dígitos).
// Mesmo aluno, formatos diferentes — comparar por "últimos 10 dígitos" deu
// miss. Solução: extrair DDD + 8 dígitos finais como chave canônica.

import fs from "node:fs";
import path from "node:path";

let cached = null;
let cachedMtime = 0;

/**
 * Normaliza um telefone (BR) para os 10 dígitos canônicos: DDD + 8 finais.
 * Tolera DDI 55 e o 9 mobile inserido. Pra números fora do BR, retorna
 * os últimos 10 dígitos (compatibilidade).
 */
export function phoneKey(s) {
  const d = String(s ?? "").replace(/\D/g, "");
  if (!d) return "";
  // Remove DDI 55 quando provável
  let n = d.length >= 12 && d.startsWith("55") ? d.slice(2) : d;
  // Remove o 9 mobile (3º dígito) quando 11 dígitos = DDD(2) + 9 + 8
  if (n.length === 11 && n[2] === "9") n = n.slice(0, 2) + n.slice(3);
  // Garante 10 dígitos finais (DDD + 8). Pra números curtos / estrangeiros,
  // preserva o que tem.
  return n.slice(-10);
}

function buildIndex() {
  const p = path.join(process.cwd(), "data", "insights.json");
  if (!fs.existsSync(p)) return new Map();
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf8"));
    const map = new Map();
    for (const [phone, data] of Object.entries(raw || {})) {
      const key = phoneKey(phone);
      if (key) map.set(key, data);
    }
    return map;
  } catch (err) {
    console.error("[insights] failed to load:", err?.message || err);
    return new Map();
  }
}

function getMap() {
  const p = path.join(process.cwd(), "data", "insights.json");
  let mtime = 0;
  try { mtime = fs.statSync(p).mtimeMs; } catch {}
  if (cached && mtime === cachedMtime) return cached;
  cached = buildIndex();
  cachedMtime = mtime;
  return cached;
}

export function getInsight(phoneOrDigits) {
  const key = phoneKey(phoneOrDigits);
  if (!key) return null;
  return getMap().get(key) || null;
}

export function getInsightsCount() {
  return getMap().size;
}
