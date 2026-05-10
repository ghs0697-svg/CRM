import { NextResponse } from "next/server";
import {
  getSlots,
  getReservation,
  isAdminAuthorized,
  getProfessionals,
} from "@/lib/booking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/booking/admin/agenda?professionalId=X&from=Y&to=Z
 *
 * Profissional vê a agenda completa COM dados privados (nome do aluno,
 * telefone, mensagem, status pagamento). Diferente de /api/booking/slots
 * que oculta tudo isso pra preservar privacidade do aluno.
 *
 * Se omitir professionalId, retorna agenda de todos os profissionais
 * (uso admin master).
 *
 * Resposta:
 *   { ok: true, professionals: [{ id, name, slots: [...] }] }
 */
export async function GET(req) {
  if (!isAdminAuthorized(req)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 }
    );
  }

  const url = new URL(req.url);
  const professionalId = url.searchParams.get("professionalId");
  const from = url.searchParams.get("from") || undefined;
  const to = url.searchParams.get("to") || undefined;

  const targetPros = professionalId
    ? getProfessionals({ includeInactive: true }).filter((p) => p.id === professionalId)
    : getProfessionals({ includeInactive: true });

  const result = [];
  for (const p of targetPros) {
    const slots = await getSlots(p.id, { from, to, includePrivate: true });

    // Anexa info da reserva quando o slot está pending/taken
    const enriched = await Promise.all(
      slots.map(async (s) => {
        if (s.reservationId) {
          const r = await getReservation(s.reservationId);
          if (r) {
            return {
              ...s,
              reservation: {
                reservationId: r.reservationId,
                studentName: r.studentName,
                studentPhone: r.studentPhone,
                plan: r.plan,
                planValue: r.planValue,
                paymentStatus: r.paymentStatus,
                message: r.message,
                createdAt: r.createdAt,
                confirmedAt: r.confirmedAt,
                canceledAt: r.canceledAt,
              },
            };
          }
        }
        return s;
      })
    );

    result.push({
      id: p.id,
      name: p.name,
      spec: p.spec,
      slots: enriched,
    });
  }

  return NextResponse.json({ ok: true, professionals: result });
}
