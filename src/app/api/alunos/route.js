import { NextResponse } from "next/server";
import { getStudents, appendStudent, getNotasSuporte, phoneSuffixMatch } from "@/lib/sheets";
import { getInsight } from "@/lib/insights";
import { auth } from "@/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const students = await getStudents();
    // Notas de perfil vivas da aba NOTAS_SUPORTE (sobrescrevem o insight estático).
    const notas = await getNotasSuporte().catch((e) => {
      console.error("[/api/students] NOTAS_SUPORTE:", e);
      return [];
    });
    const enriched = students.map((s) => {
      const insight = getInsight(s.contato);
      const nota = notas.find((n) => phoneSuffixMatch(s.contato, n.digits));
      const out = { ...s };
      if (insight) out.insight = insight;
      if (nota) out.notaSuporte = { nota: nota.nota, atualizado: nota.atualizado };
      return out;
    });
    return NextResponse.json({ ok: true, students: enriched });
  } catch (err) {
    console.error("[/api/students] erro:", err);
    return NextResponse.json(
      { ok: false, error: String(err?.message || err) },
      { status: 500 }
    );
  }
}

export async function POST(req) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ ok: false, error: "Não autenticado" }, { status: 401 });
    }
    const body = await req.json();
    const result = await appendStudent(body);
    console.log(`[/api/students POST] ${session.user.email} adicionou linha ${result.row}: ${body.nome}`);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[/api/students POST] erro:", err);
    return NextResponse.json(
      { ok: false, error: String(err?.message || err) },
      { status: 400 }
    );
  }
}
