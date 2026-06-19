import { NextResponse } from "next/server";
import { getAlunoConsolidado, registrarRenovacao } from "@/lib/renovacao";
import { auth } from "@/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/renovacao?cpf=... | ?phone=...  → estado consolidado (pré-preenche o form)
export async function GET(req) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ ok: false, error: "Não autenticado" }, { status: 401 });
    }
    const sp = new URL(req.url).searchParams;
    const data = await getAlunoConsolidado({ cpf: sp.get("cpf"), phone: sp.get("phone") });
    return NextResponse.json(data);
  } catch (err) {
    console.error("[GET /api/renovacao] erro:", err);
    return NextResponse.json({ ok: false, error: String(err?.message || err) }, { status: 400 });
  }
}

// POST /api/renovacao  → registra a renovação na mestre (idempotente; via endpoint da Mestre)
export async function POST(req) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ ok: false, error: "Não autenticado" }, { status: 401 });
    }
    const body = await req.json();
    const result = await registrarRenovacao(body);
    const tag = result?.ok
      ? `linha ${result.linha || "?"}${result.duplicate ? " (dup)" : ""} v${result.versao || "?"}`
      : `falhou: ${result?.error || "?"}`;
    console.log(`[POST /api/renovacao] ${session.user.email} → ${tag}`);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[POST /api/renovacao] erro:", err);
    return NextResponse.json({ ok: false, error: String(err?.message || err) }, { status: 400 });
  }
}
