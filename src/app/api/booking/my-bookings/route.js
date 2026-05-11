import { NextResponse } from "next/server";
import {
  getReservationsByPhone,
  getCreditsDetail,
  getProfessionals,
} from "@/lib/booking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/booking/my-bookings?phone=<phone>&upcoming=1
 *
 * Aluno vê os próprios agendamentos + saldo de créditos por profissional.
 * `upcoming=1` filtra apenas agendamentos futuros não-cancelados.
 *
 * Resposta:
 *   {
 *     ok: true,
 *     reservations: [...],
 *     credits: {
 *       vitor: { remaining: 2, expiresAt: "2026-07-08" },
 *       bruna: { remaining: 0, expiresAt: null }
 *     }
 *   }
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

  const pros = getProfessionals();
  const credits = {};
  for (const p of pros) {
    credits[p.id] = await getCreditsDetail(phone, p.id);
  }

  return NextResponse.json({ ok: true, reservations, credits });
}
