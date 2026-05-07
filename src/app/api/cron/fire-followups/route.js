import { NextResponse } from "next/server";
import { getStudents, markFollowUpFired } from "@/lib/db";

// Roda como cron na Vercel — precisa runtime Node, não Edge.
export const runtime = "nodejs";
// Sem cache: cada chamada lê estado fresh do KV.
export const dynamic = "force-dynamic";

const MANYCHAT_SEND_FLOW_URL = "https://api.manychat.com/fb/sending/sendFlow";

/**
 * Helper: dado uma string de tag tipo "7 dias" ou "1 dia", retorna o número.
 */
function tagDays(tag) {
  const m = String(tag || "").match(/\d+/);
  return m ? parseInt(m[0], 10) : NaN;
}

/**
 * Helper: data ISO YYYY-MM-DD em UTC (a granularidade do CRM é de 1 dia,
 * não importa fuso pra bater dueDate).
 */
function isoToday() {
  return new Date().toISOString().split("T")[0];
}

/**
 * Calcula data de vencimento do follow-up: assignmentDate + dias.
 * Retorna ISO YYYY-MM-DD.
 */
function dueDateFor(student, fu) {
  const days = tagDays(fu.tag);
  if (!Number.isFinite(days)) return null;
  const d = new Date(student.assignmentDate);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0];
}

/**
 * Chama a Send API do ManyChat pra disparar o flow num subscriber.
 * Retorna { ok, status, body } pra logging.
 */
async function sendFlowToSubscriber(subscriberId, flowNs, apiKey) {
  try {
    const res = await fetch(MANYCHAT_SEND_FLOW_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        subscriber_id: String(subscriberId),
        flow_ns: flowNs,
      }),
    });
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { body = text; }
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    return { ok: false, status: 0, body: String(err?.message || err) };
  }
}

/**
 * GET /api/cron/fire-followups
 *
 * Disparado pela Vercel Cron 1x/dia. Varre todos os alunos no KV, identifica
 * follow-ups vencidos (status=pendente, dueDate<=hoje, ainda não disparados,
 * com subscriberId), e dispara cada um pro flow do ManyChat.
 *
 * AUTENTICAÇÃO: header `Authorization: Bearer <CRON_SECRET>` OU query param
 * `?secret=<CRON_SECRET>`. Vercel Cron usa o header automaticamente.
 *
 * Resposta: { ok, scanned, eligible, fired, skipped, errors }
 */
export async function GET(req) {
  // Auth: Vercel Cron manda header Authorization: Bearer ${CRON_SECRET}
  // (configurado em vercel.json). Aceita query param tb pra debug manual.
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET não configurado nas env vars" },
      { status: 500 }
    );
  }
  const authHeader = req.headers.get("authorization") || "";
  const headerToken = authHeader.replace(/^Bearer\s+/i, "").trim();
  const url = new URL(req.url);
  const queryToken = url.searchParams.get("secret") || "";
  if (headerToken !== expected && queryToken !== expected) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.MANYCHAT_API_KEY;
  const flowNs = process.env.MANYCHAT_FLOW_NS;
  const dryRun = url.searchParams.get("dryRun") === "1";

  if (!apiKey || !flowNs) {
    return NextResponse.json(
      {
        ok: false,
        error: "MANYCHAT_API_KEY e MANYCHAT_FLOW_NS precisam estar setadas",
        hasApiKey: !!apiKey,
        hasFlowNs: !!flowNs,
      },
      { status: 500 }
    );
  }

  const today = isoToday();
  const students = await getStudents();
  const results = {
    scanned: 0,
    eligible: 0,
    fired: 0,
    skipped: { noSubscriber: 0, alreadyFired: 0, notDue: 0, notPending: 0 },
    errors: [],
  };

  for (const student of students) {
    for (const fu of student.followUps || []) {
      results.scanned++;

      if (fu.status !== "pendente") {
        results.skipped.notPending++;
        continue;
      }
      if (fu.firedAt) {
        results.skipped.alreadyFired++;
        continue;
      }
      const due = dueDateFor(student, fu);
      if (!due || due > today) {
        results.skipped.notDue++;
        continue;
      }
      if (!student.subscriberId) {
        results.skipped.noSubscriber++;
        results.errors.push({
          phone: student.phone,
          name: student.name,
          tag: fu.tag,
          reason: "sem subscriberId — webhook ManyChat não enviou ID do contato",
        });
        continue;
      }

      results.eligible++;

      if (dryRun) {
        // Modo de simulação — não chama ManyChat nem grava firedAt.
        continue;
      }

      const r = await sendFlowToSubscriber(student.subscriberId, flowNs, apiKey);

      if (r.ok && r.body?.status !== "error") {
        await markFollowUpFired(student.phone, fu.tag, today);
        results.fired++;
      } else {
        results.errors.push({
          phone: student.phone,
          name: student.name,
          tag: fu.tag,
          subscriberId: student.subscriberId,
          httpStatus: r.status,
          response: r.body,
        });
      }
    }
  }

  console.log("[cron/fire-followups]", JSON.stringify(results));

  return NextResponse.json({ ok: true, today, dryRun, ...results });
}
