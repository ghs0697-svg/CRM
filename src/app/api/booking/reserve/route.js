import { NextResponse } from "next/server";
import { createReservation, getProfessional } from "@/lib/booking";

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
 *     plan: "avulso" | "pacote" | "credit",  // credit = usa crédito de pacote
 *     studentName: "...",
 *     studentPhone: "5555...",
 *     studentSubscriberId: "...",  // opcional (ManyChat)
 *     message: "..."  // opcional, contexto pra o profissional
 *   }
 *
 * Resposta sucesso:
 *   { ok: true, reservationId, paymentLink, externalRef, expiresAt, isCreditPayment }
 *
 *   - Se isCreditPayment=true → reserva já confirmada (pagou com crédito), não tem paymentLink
 *   - Se false → aluno é redirecionado pra paymentLink (Greenn) e tem 15min pra pagar
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
    plan,
    studentName,
    studentPhone,
    studentSubscriberId,
    message,
  } = body;

  // Validações básicas
  if (!professionalId || !slotDate || !slotId || !plan) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "professionalId, slotDate, slotId e plan são obrigatórios",
      },
      { status: 400 }
    );
  }
  if (!["avulso", "pacote", "credit"].includes(plan)) {
    return NextResponse.json(
      { ok: false, error: "plan deve ser avulso, pacote ou credit" },
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

  // Se for plan avulso/pacote, o profissional precisa ter link Greenn configurado
  if (plan !== "credit") {
    const greennLink =
      plan === "pacote"
        ? prof.pricing.pacote4.greennLink
        : prof.pricing.avulso.greennLink;
    if (!greennLink) {
      return NextResponse.json(
        {
          ok: false,
          error: `Greenn ainda não configurado pro plano ${plan} de ${prof.name}. Avise o admin.`,
        },
        { status: 503 }
      );
    }
  }

  const result = await createReservation({
    professionalId,
    slotDate,
    slotId,
    plan,
    studentName,
    studentPhone,
    studentSubscriberId,
    message,
    useCredit: plan === "credit",
  });

  if (!result.ok) {
    return NextResponse.json(result, { status: 409 });
  }

  return NextResponse.json(result);
}
