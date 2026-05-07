import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KV_PUSH_KEY = "treino:pushSubs";

async function getKV() {
  const mod = await import("@vercel/kv");
  return mod.kv;
}

/**
 * POST /api/push/subscribe
 * body: { studentId, studentName, subscription }
 *  - studentId: identificador único (sheetId do aluno)
 *  - subscription: PushSubscription serializado
 *
 * Salva no KV (lista) — dedup por studentId+endpoint.
 */
export async function POST(req) {
  try {
    const body = await req.json();
    const { studentId, studentName, subscription } = body || {};
    if (!subscription || !subscription.endpoint) {
      return NextResponse.json(
        { ok: false, error: "subscription inválida" },
        { status: 400 }
      );
    }
    const kv = await getKV();
    const list = (await kv.get(KV_PUSH_KEY)) || [];
    const filtered = list.filter(
      (s) => s.subscription?.endpoint !== subscription.endpoint
    );
    filtered.push({
      studentId: studentId || "",
      studentName: studentName || "",
      subscription,
      createdAt: Date.now(),
    });
    await kv.set(KV_PUSH_KEY, filtered);
    return NextResponse.json({ ok: true, count: filtered.length });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err?.message || err) },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/push/subscribe
 * body: { endpoint }  — remove a inscrição (toggle off)
 */
export async function DELETE(req) {
  try {
    const body = await req.json();
    const endpoint = body?.endpoint;
    if (!endpoint) {
      return NextResponse.json({ ok: false, error: "endpoint requerido" }, { status: 400 });
    }
    const kv = await getKV();
    const list = (await kv.get(KV_PUSH_KEY)) || [];
    const filtered = list.filter((s) => s.subscription?.endpoint !== endpoint);
    await kv.set(KV_PUSH_KEY, filtered);
    return NextResponse.json({ ok: true, removed: list.length - filtered.length });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err?.message || err) },
      { status: 500 }
    );
  }
}
