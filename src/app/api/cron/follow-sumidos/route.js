import { NextResponse } from "next/server";
import { runFollowSumidos } from "@/lib/follow-sumidos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/cron/follow-sumidos
 *
 * Cron diário (Vercel). Monta o roster de alunos sumidos (ativos, 7+ dias sem
 * treinar pelo app) e grava na aba FOLLOW_SUMIDOS da mestre, com a flag
 * elegivelAgora (cadência de 7 dias). NÃO manda WhatsApp: o Make lê as linhas
 * elegivelAgora=SIM, dispara via Z-API em drip e carimba ultimoContato de volta.
 *
 * Auth: header `Authorization: Bearer <CRON_SECRET>` (Vercel Cron usa esse) OU
 * `?secret=<CRON_SECRET>` pra teste manual.
 * `?dryRun=1` → só computa e devolve o roster (não grava na aba, não dispara).
 */
export async function GET(req) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ ok: false, error: "CRON_SECRET não configurado" }, { status: 500 });
  }
  const headerToken = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const url = new URL(req.url);
  const queryToken = url.searchParams.get("secret") || "";
  if (headerToken !== expected && queryToken !== expected) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const dryRun = url.searchParams.get("dryRun") === "1";
  try {
    const result = await runFollowSumidos({ dryRun });
    console.log("[cron/follow-sumidos]", JSON.stringify({ dryRun, total: result.total, elegiveis: result.elegiveis }));
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[cron/follow-sumidos] erro:", err);
    return NextResponse.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
  }
}
