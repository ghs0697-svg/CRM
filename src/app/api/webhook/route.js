import { NextResponse } from "next/server";
import { upsertStudent, buildStudentFromWebhook } from "@/lib/db";

// Força runtime Node (default no App Router, mas explicitar evita surpresa
// se algum import do db acabar puxando coisas Node-only).
export const runtime = "nodejs";

// ManyChat às vezes manda Content-Type vazio ou form-urlencoded. Aceita os 3.
async function parseBody(req) {
  const ct = (req.headers.get("content-type") || "").toLowerCase();
  if (ct.includes("application/json")) {
    return req.json();
  }
  if (ct.includes("application/x-www-form-urlencoded")) {
    const text = await req.text();
    const params = new URLSearchParams(text);
    return Object.fromEntries(params.entries());
  }
  // Fallback: tenta JSON, se falhar volta texto cru pra debug
  const text = await req.text();
  try { return JSON.parse(text); } catch { return { _raw: text }; }
}

/**
 * POST /api/webhook
 *
 * Body esperado (qualquer um destes formatos serve):
 *   { "name": "João da Silva", "phone": "5511999991111", "tag": "7 dias" }
 *   { "Nome Completo": "...", "Telefone": "...", "Tag de Tempo": "7 dias" }
 *
 * Campos opcionais: seller, observations.
 *
 * Resposta: 200 { ok: true, student: {...} } pro ManyChat.
 */
export async function POST(req) {
  try {
    const body = await parseBody(req);
    const student = buildStudentFromWebhook(body);

    if (!student.name || !student.phone) {
      return NextResponse.json(
        { ok: false, error: "name e phone são obrigatórios", received: body },
        { status: 400 }
      );
    }

    const { student: saved, created } = await upsertStudent(student);
    return NextResponse.json({ ok: true, student: saved, created });
  } catch (err) {
    console.error("[webhook] erro:", err);
    return NextResponse.json(
      { ok: false, error: String(err?.message || err) },
      { status: 500 }
    );
  }
}

// Health check (GET no mesmo path) — útil pra confirmar que a rota tá no ar
export async function GET() {
  return NextResponse.json({ ok: true, hint: "POST aqui pra registrar aluno" });
}
