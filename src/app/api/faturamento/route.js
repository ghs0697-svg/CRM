import { NextResponse } from "next/server";
import { getVendasPorDia } from "@/lib/faturamento";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/faturamento — vendas por dia, direto da CONTROLE ALUNOS (mestre). */
export async function GET() {
  try {
    const data = await getVendasPorDia();
    return NextResponse.json({ ok: true, ...data });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err?.message || err) },
      { status: 500 }
    );
  }
}
