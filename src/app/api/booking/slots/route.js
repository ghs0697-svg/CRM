import { NextResponse } from "next/server";
import { getSlots, cleanupExpiredReservations } from "@/lib/booking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/booking/slots?professional=<id>&from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Lista slots de um profissional numa janela de datas.
 * Privacidade: aluno vê só { id, date, start, end, status } — nunca o nome
 * de quem reservou.
 *
 * Antes de listar, faz cleanup lazy de reservas expiradas (libera slots que
 * ficaram pending sem ninguém pagar).
 *
 * Resposta: { ok: true, slots: [...] }
 */
export async function GET(req) {
  const url = new URL(req.url);
  const professionalId = url.searchParams.get("professional");
  const from = url.searchParams.get("from") || undefined;
  const to = url.searchParams.get("to") || undefined;

  if (!professionalId) {
    return NextResponse.json(
      { ok: false, error: "professional é obrigatório" },
      { status: 400 }
    );
  }

  // Cleanup lazy (idempotente — libera slots de reservas expiradas)
  try {
    await cleanupExpiredReservations();
  } catch (err) {
    console.warn("[booking/slots] cleanup falhou:", err);
  }

  const slots = await getSlots(professionalId, { from, to, includePrivate: false });
  return NextResponse.json({ ok: true, slots });
}
