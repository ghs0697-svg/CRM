import { NextResponse } from "next/server";
import { createReservation, getProfessional, getPlan } from "@/lib/booking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/booking/reserve
 *
 * Body:
 *   {
 *     professionalId: "vitor",
 *     slotDate: "2026-05-12",
 *     slotId: "slot_xxx",
 *     planId: "1x" | "2x" | "4x" | "8x" | "credit",
 *     studentName: "...",
 *     studentPhone: "5555...",
 *     studentSubscriberId: "...",   // opcional (ManyChat)
 *     message: "..."                // opcional, contexto pra o profissional
 *   }
 *
 * Resposta sucesso:
 *   { ok: true, reservationId, paymentLink, externalRef, expiresAt, isCreditPayment }
 *
 *   - planId="credit" → reserva já confirmada (pagou com crédito), sem paymentLink
 *   - outros plans  → aluno é redirecionado pra paymentLink (Greenn), 15min pra pagar
 */
export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "body deve ser JSON" },
      { status: 400 }
    );
  }

  const {
    professionalId,
    slotDate,
    slotId,
    planId,
    studentName,
    studentPhone,
    studentSubscriberId,
    message,
  } = body;

  // Validações básicas
  if (!professionalId || !slotDate || !slotId || !planId) {
    return NextResponse.json(
      {
        ok: false,
        error: "professionalId, slotDate, slotId e planId são obrigatórios",
      },
      { status: 400 }
    );
  }
  if (!studentName || !studentPhone) {
    return NextResponse.json(
      { ok: false, error: "studentName e studentPhone são obrigatórios" },
      { status: 400 }
    );
  }

  const prof = getProfessional(professionalId);
  if (!prof) {
    return NextResponse.json(
      { ok: false, error: "profissional não encontrado" },
      { status: 404 }
    );
  }

  // Se não for credit, valida que plano existe
  if (planId !== "credit") {
    const plan = getPlan(professionalId, planId);
    if (!plan) {
      return NextResponse.json(
        {
          ok: false,
          error: `plano ${planId} não existe pra ${prof.name}`,
          availablePlans: prof.plans.map((p) => p.id),
        },
        { status: 400 }
      );
    }
    if (!plan.greennLink) {
      return NextResponse.json(
        {
          ok: false,
          error: `Greenn ainda não configurado pro plano ${planId} de ${prof.name}. Avise o admin.`,
        },
        { status: 503 }
      );
    }
  }

  const result = await createReservation({
    professionalId,
    slotDate,
    slotId,
    planId,
    studentName,
    studentPhone,
    studentSubscriberId,
    message,
  });

  if (!result.ok) {
    return NextResponse.json(result, { status: 409 });
  }

  return NextResponse.json(result);
}
