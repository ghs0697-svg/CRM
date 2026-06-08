import { NextResponse } from "next/server";
import { getStudents, appendStudent } from "@/lib/sheets";
import { getInsight } from "@/lib/insights";
import { auth } from "@/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const students = await getStudents();
    const enriched = students.map((s) => {
      const insight = getInsight(s.contato);
      return insight ? { ...s, insight } : s;
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
