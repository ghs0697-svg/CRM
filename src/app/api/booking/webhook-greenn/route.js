import { NextResponse } from "next/server";
import {
  getReservation,
  confirmReservation,
  releaseReservation,
} from "@/lib/booking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/booking/webhook-greenn
 *
 * Recebe eventos de pagamento da Greenn. Identifica a reserva via
 * `external_reference` (que mandamos no checkout) e atualiza status.
 *
 * Eventos esperados:
 *   - purchase.approved / paid / pago        → confirma reserva (slot vira taken)
 *   - purchase.canceled / canceled / refused → libera slot
 *   - purchase.refunded                      → marca como reembolsada
 *
 * AUTENTICAÇÃO: Greenn deve mandar header `X-Greenn-Signature` ou similar
 * (depende do que GH descobrir no painel deles). Aceita também:
 *   - Header `X-Webhook-Secret: <GREENN_WEBHOOK_SECRET>`
 *   - Query param `?secret=<GREENN_WEBHOOK_SECRET>`
 *
 * Como a doc da Greenn pode variar, este endpoint:
 *   1. Tenta parsear o body em vários formatos comuns
 *   2. Procura `external_reference` em locais possíveis
 *   3. Loga tudo no Vercel logs pra debug inicial
 */
export async function POST(req) {
  // Auth
  const expected = process.env.GREENN_WEBHOOK_SECRET;
  if (expected) {
    const headerSecret =
      req.headers.get("x-webhook-secret") ||
      req.headers.get("x-greenn-signature") ||
      "";
    const url = new URL(req.url);
    const querySecret = url.searchParams.get("secret") || "";
    if (headerSecret !== expected && querySecret !== expected) {
      console.warn("[booking/webhook-greenn] UNAUTHORIZED:", {
        headerSecret: !!headerSecret,
        querySecret: !!querySecret,
      });
      return NextResponse.json(
        { ok: false, error: "unauthorized" },
        { status: 401 }
      );
    }
  } else {
    console.warn(
      "[booking/webhook-greenn] GREENN_WEBHOOK_SECRET não configurado — endpoint aberto (config pendente)"
    );
  }

  // Parse body (várias possibilidades)
  let body;
  try {
    body = await req.json();
  } catch {
    try {
      const text = await req.text();
      body = { _raw: text };
    } catch {
      body = {};
    }
  }

  console.log("[booking/webhook-greenn] payload:", JSON.stringify(body));

  // Tenta achar external_reference em locais comuns
  const externalRef =
    body.external_reference ||
    body.externalReference ||
    body?.data?.external_reference ||
    body?.data?.externalReference ||
    body?.purchase?.external_reference ||
    body?.transaction?.external_reference ||
    body?.metadata?.external_reference ||
    null;

  // Tenta achar event/status
  const eventName = (
    body.event ||
    body.type ||
    body.status ||
    body?.data?.status ||
    body?.purchase?.status ||
    ""
  )
    .toString()
    .toLowerCase();

  const transactionId =
    body.transaction_id ||
    body.transactionId ||
    body?.data?.id ||
    body?.purchase?.id ||
    null;

  if (!externalRef) {
    console.error(
      "[booking/webhook-greenn] sem external_reference — não dá pra identificar reserva"
    );
    return NextResponse.json(
      {
        ok: false,
        error: "external_reference não encontrado no payload",
        received: body,
      },
      { status: 400 }
    );
  }

  const reservation = await getReservation(externalRef);
  if (!reservation) {
    console.error(
      "[booking/webhook-greenn] reserva não encontrada:",
      externalRef
    );
    return NextResponse.json(
      { ok: false, error: "reserva não encontrada", externalRef },
      { status: 404 }
    );
  }

  // Decide ação por categoria de evento
  const isPaid =
    eventName.includes("approv") ||
    eventName.includes("paid") ||
    eventName.includes("pago") ||
    eventName.includes("complet") ||
    eventName.includes("success");
  const isCanceled =
    eventName.includes("cancel") ||
    eventName.includes("refus") ||
    eventName.includes("expir") ||
    eventName.includes("fail");
  const isRefunded = eventName.includes("refund") || eventName.includes("estorn");

  let result;
  if (isPaid) {
    result = await confirmReservation(externalRef, {
      paymentTransactionId: transactionId,
    });
  } else if (isCanceled) {
    result = await releaseReservation(externalRef, "canceled");
  } else if (isRefunded) {
    // Marca a reserva como refunded — slot já estava liberado por cancel anterior
    // ou marca explicitamente
    result = await releaseReservation(externalRef, "refunded");
  } else {
    console.log(
      "[booking/webhook-greenn] evento ignorado:",
      eventName,
      "ref:",
      externalRef
    );
    return NextResponse.json({
      ok: true,
      action: "ignored",
      reason: `evento '${eventName}' não mapeado pra ação`,
    });
  }

  return NextResponse.json({
    ok: true,
    action: isPaid ? "confirmed" : isCanceled ? "released" : "refunded",
    reservationId: externalRef,
    result,
  });
}

// Greenn às vezes valida endpoint via GET (handshake) — responde 200 OK
export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: "booking-webhook-greenn",
    hint: "POST aqui pra registrar evento de pagamento",
  });
}
