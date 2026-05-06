import { NextResponse } from "next/server";
import { getStudents, clearAll, deleteStudentByPhone } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic"; // evita cache do Next em fetch GET

/** GET /api/students — retorna a lista atual de alunos persistidos. */
export async function GET() {
  try {
    const students = await getStudents();
    return NextResponse.json({ ok: true, students });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err?.message || err) },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/students  — apaga itens do storage.
 *   ?wipe=wipe-crm-gh-2026          → apaga TUDO (cuidado)
 *   ?phone=5511999991111            → apaga só o aluno desse telefone
 */
export async function DELETE(req) {
  try {
    const { searchParams } = new URL(req.url);
    const wipe = searchParams.get("wipe");
    const phone = searchParams.get("phone");

    if (wipe === "wipe-crm-gh-2026") {
      await clearAll();
      return NextResponse.json({ ok: true, cleared: "all" });
    }
    if (phone) {
      const removed = await deleteStudentByPhone(phone);
      return NextResponse.json({ ok: true, removed });
    }
    return NextResponse.json(
      { ok: false, error: "passe ?wipe=<token> ou ?phone=<numero>" },
      { status: 400 }
    );
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err?.message || err) },
      { status: 500 }
    );
  }
}
