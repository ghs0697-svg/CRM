import { NextResponse } from "next/server";
import { getSupportTickets } from "@/lib/sheets";
import { getResolvidos, setResolvido } from "@/lib/suporte-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Pedidos de ajuste + feedbacks dos alunos (read-only nas abas) pra aba Suporte.
// O estado "resolvido" é triagem local do CRM (KV/arquivo), não toca a mestre.
export async function GET() {
  try {
    const data = await getSupportTickets();
    // Resolvidos é acessório: se o storage falhar, a lista ainda carrega.
    let resolvidos = {};
    try { resolvidos = await getResolvidos(); } catch (e) { console.error("[/api/suporte] resolvidos:", e); }
    return NextResponse.json({ ok: true, ...data, resolvidos });
  } catch (err) {
    console.error("[/api/suporte] erro:", err);
    return NextResponse.json(
      { ok: false, error: String(err?.message || err) },
      { status: 500 }
    );
  }
}

// Marca/desmarca um item como resolvido. Body: { key, resolved }
export async function POST(req) {
  try {
    const body = await req.json();
    const key = String(body?.key || "").trim();
    if (!key) return NextResponse.json({ ok: false, error: "key obrigatória" }, { status: 400 });
    await setResolvido(key, !!body?.resolved);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[/api/suporte] POST erro:", err);
    return NextResponse.json(
      { ok: false, error: String(err?.message || err) },
      { status: 500 }
    );
  }
}
