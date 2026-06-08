import { NextResponse } from "next/server";
import { getLeadsStats } from "@/lib/leads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const monthKey = searchParams.get("month") || undefined;
    const stats = await getLeadsStats({ monthKey });
    return NextResponse.json({ ok: true, ...stats });
  } catch (err) {
    console.error("[/api/leads-stats] erro:", err);
    return NextResponse.json(
      { ok: false, error: String(err?.message || err) },
      { status: 500 }
    );
  }
}
