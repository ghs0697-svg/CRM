import { NextResponse } from "next/server";
import webpush from "web-push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KV_PUSH_KEY = "treino:pushSubs";

async function getKV() {
  const mod = await import("@vercel/kv");
  return mod.kv;
}

function configureVapid() {
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:ghs0697@gmail.com";
  if (!pub || !priv) throw new Error("VAPID keys ausentes (env vars VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY)");
  webpush.setVapidDetails(subject, pub, priv);
}

/**
 * POST /api/push/send-water
 * Disparado pelo Vercel Cron toda hora entre 8h-22h SP.
 * Pode ser chamado manual com ?token=<CRON_SECRET> pra testes.
 *
 * Loops por todas as subscriptions salvas no KV e manda push genérico
 * "💧 Hora da água!". O service worker do app mostra a notificação.
 */
export async function GET(req) {
  return handle(req);
}
export async function POST(req) {
  return handle(req);
}

async function handle(req) {
  try {
    // Auth: aceita header Authorization=Bearer <secret> (cron Vercel) ou ?token=<secret>
    const authHeader = req.headers.get("authorization") || "";
    const url = new URL(req.url);
    const tokenParam = url.searchParams.get("token") || "";
    const secret = process.env.CRON_SECRET || "";
    const ok =
      authHeader === `Bearer ${secret}` ||
      tokenParam === secret ||
      // Vercel Cron sempre passa header com bearer do CRON_SECRET configurado
      (req.headers.get("x-vercel-cron") && secret && authHeader === `Bearer ${secret}`);
    if (secret && !ok) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    // Gate de horário: só dispara entre 8h e 22h SP (timezone America/Sao_Paulo).
    // Pode pular o gate com ?force=1 pra teste.
    const force = url.searchParams.get("force") === "1";
    if (!force) {
      const spHour = parseInt(
        new Intl.DateTimeFormat("pt-BR", {
          timeZone: "America/Sao_Paulo",
          hour: "2-digit",
          hour12: false,
        }).format(new Date()),
        10
      );
      if (spHour < 8 || spHour > 22) {
        return NextResponse.json({ ok: true, skipped: true, reason: "fora do horário 8h-22h SP", spHour });
      }
    }

    configureVapid();
    const kv = await getKV();
    const list = (await kv.get(KV_PUSH_KEY)) || [];
    if (!list.length) return NextResponse.json({ ok: true, sent: 0 });

    const payload = JSON.stringify({
      title: "💧 Hora da água!",
      body: "Já tomou água? Marca +1 copo no app.",
      tag: "water-reminder",
      url: "/",
    });

    let sent = 0,
      failed = 0;
    const stillValid = [];
    for (const s of list) {
      try {
        await webpush.sendNotification(s.subscription, payload, { TTL: 600 });
        sent++;
        stillValid.push(s);
      } catch (err) {
        // 410 = subscription expirada/cancelada — remove do KV
        const sc = err?.statusCode || 0;
        if (sc === 404 || sc === 410) {
          // não adiciona em stillValid → será removida
        } else {
          stillValid.push(s); // mantém pra próxima tentativa (erro temporário)
        }
        failed++;
      }
    }
    if (stillValid.length !== list.length) {
      await kv.set(KV_PUSH_KEY, stillValid);
    }
    return NextResponse.json({ ok: true, sent, failed, totalSubs: list.length });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err?.message || err) },
      { status: 500 }
    );
  }
}
