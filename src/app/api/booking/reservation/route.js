import { NextResponse } from "next/server";
import { getReservation, getProfessional } from "@/lib/booking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/booking/reservation?id=res_xxx
 *
 * Retorna detalhes sanitizados de uma reserva — usado pela página
 * /booking/sucesso pro aluno ver o agendamento confirmado.
 *
 * Sanitização: omite subscriber_id (interno) e qualquer dado sensível.
 * Mantém nome, profissional, data, hora, plano, status pagamento.
 *
 * SEM auth — o reservationId é uma string aleatória longa, dificilmente
 * adivinhável. Quem tem o link tem acesso (mesma lógica do "share by link"
 * do Google Docs). Em produção real, vale exigir phone+id pra validar.
 */
export async function GET(req) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) {
    return NextResponse.json(
      { ok: false, error: "id é obrigatório" },
      { status: 400 }
    );
  }

  const r = await getReservation(id);
  if (!r) {
    return NextResponse.json(
      { ok: false, error: "reserva não encontrada" },
      { status: 404 }
    );
  }

  const prof = getProfessional(r.professionalId);

  return NextResponse.json({
    ok: true,
    reservation: {
      reservationId: r.reservationId,
      professional: {
        id: r.professionalId,
        name: r.professionalName,
        spec: prof?.spec || "",
        photo: prof?.photo || "",
        durationMin: prof?.durationMin || 0,
      },
      slotDate: r.slotDate,
      slotStart: r.slotStart,
      slotEnd: r.slotEnd,
      planId: r.planId,
      planSessions: r.planSessions,
      planValue: r.planValue,
      studentName: r.studentName,
      studentPhone: r.studentPhone,
      message: r.message,
      paymentStatus: r.paymentStatus,
      createdAt: r.createdAt,
      confirmedAt: r.confirmedAt,
      canceledAt: r.canceledAt,
    },
  });
}
