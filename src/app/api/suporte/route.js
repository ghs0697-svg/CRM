import { NextResponse } from "next/server";
import { getSupportTickets } from "@/lib/sheets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Pedidos de ajuste + feedbacks dos alunos (read-only) pra aba Suporte.
export async function GET() {
  try {
    const data = await getSupportTickets();
    return NextResponse.json({ ok: true, ...data });
  } catch (err) {
    console.error("[/api/suporte] erro:", err);
    return NextResponse.json(
      { ok: false, error: String(err?.message || err) },
      { status: 500 }
    );
  }
}
