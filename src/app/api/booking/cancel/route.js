import { NextResponse } from "next/server";
import { cancelReservation, getReservation } from "@/lib/booking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/booking/cancel
 *
 * Aluno cancela uma reserva.
 *
 * Body:
 *   { reservationId: "...", studentPhone: "..." }
 *
 * Regras:
 *   - >= 24h antes do slot → cancela, libera slot, sinaliza pra estorno
 *   - <  24h antes        → 409, sem cancelamento (texto explícito pra UI)
 *
 * Estorno via API da Greenn: tentamos chamar se GREENN_API_KEY estiver
 * configurada e a reserva tiver paymentTransactionId. Senão fica manual
 * (admin estorna pelo painel da Greenn).
 *
 * Resposta sucesso:
 *   { ok: true, eligibleForRefund, refundAttempted, refundResult? }
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

  const { reservationId, studentPhone } = body;
  if (!reservationId || !studentPhone) {
    return NextResponse.json(
      { ok: false, error: "reservationId e studentPhone são obrigatórios" },
      { status: 400 }
    );
  }

  const r = await getReservation(reservationId);
  if (!r) {
    return NextResponse.json(
      { ok: false, error: "reserva não encontrada" },
      { status: 404 }
    );
  }

  // Tenta cancelar via lib (valida 24h + libera slot)
  const result = await cancelReservation(reservationId, {
    byStudentPhone: studentPhone,
  });

  if (!result.ok) {
    return NextResponse.json(result, { status: 409 });
  }

  // Se elegível pra reembolso e tem credenciais Greenn, tenta estornar via API
  let refundResult = null;
  let refundAttempted = false;
  if (result.eligibleForRefund && process.env.GREENN_API_KEY && r.paymentTransactionId) {
    refundAttempted = true;
    try {
      // Endpoint da Greenn pra estorno — formato suposto, pode precisar ajuste
      // depois que GH confirmar a doc oficial
      const greennRes = await fetch(
        `https://api.greenn.com.br/v1/transactions/${r.paymentTransactionId}/refund`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.GREENN_API_KEY}`,
          },
          body: JSON.stringify({
            reason: "cancelamento_pelo_aluno",
            external_reference: reservationId,
          }),
        }
      );
      const text = await greennRes.text();
      let parsed;
      try { parsed = JSON.parse(text); } catch { parsed = text; }
      refundResult = {
        ok: greennRes.ok,
        status: greennRes.status,
        body: parsed,
      };
      console.log(
        "[booking/cancel] refund tentado:",
        reservationId,
        refundResult
      );
    } catch (err) {
      refundResult = { ok: false, error: String(err?.message || err) };
      console.error("[booking/cancel] refund falhou:", err);
    }
  }

  return NextResponse.json({
    ok: true,
    eligibleForRefund: result.eligibleForRefund,
    refundAttempted,
    refundResult,
    note: result.eligibleForRefund && !refundAttempted
      ? "Slot liberado. Estorno automático não disponível — admin estorna manual via Greenn."
      : undefined,
  });
}
