import { NextResponse } from "next/server";
import { getReservationsByPhone, getCredits, getProfessionals } from "@/lib/booking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/booking/my-bookings?phone=<phone>&upcoming=1
 *
 * Aluno vê os próprios agendamentos. Retorna também saldo de créditos
 * por profissional.
 *
 * `upcoming=1` filtra apenas agendamentos futuros e não-cancelados.
 *
 * Resposta:
 *   { ok: true, reservations: [...], credits: { vitor: 2, bruna: 0 } }
 */
export async function GET(req) {
  const url = new URL(req.url);
  const phone = url.searchParams.get("phone");
  const upcomingOnly = url.searchParams.get("upcoming") === "1";

  if (!phone) {
    return NextResponse.json(
      { ok: false, error: "phone é obrigatório" },
      { status: 400 }
    );
  }

  const reservations = await getReservationsByPhone(phone, { upcomingOnly });

  // Saldo de créditos por profissional ativo
  const pros = getProfessionals();
  const credits = {};
  for (const p of pros) {
    credits[p.id] = await getCredits(phone, p.id);
  }

  return NextResponse.json({ ok: true, reservations, credits });
}
