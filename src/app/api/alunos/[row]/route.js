import { NextResponse } from "next/server";
import { updateStudent } from "@/lib/sheets";
import { auth } from "@/auth";

export const runtime = "nodejs";

export async function PATCH(req, { params }) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ ok: false, error: "Não autenticado" }, { status: 401 });
    }
    const { row } = await params;
    const rowNum = parseInt(row, 10);
    if (!Number.isInteger(rowNum) || rowNum < 2) {
      return NextResponse.json({ ok: false, error: "row inválido" }, { status: 400 });
    }
    const body = await req.json();
    const result = await updateStudent(rowNum, body);
    console.log(`[PATCH /api/students/${row}] ${session.user.email} → ${result.fields.join(", ")}`);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[PATCH /api/students/:row] erro:", err);
    return NextResponse.json(
      { ok: false, error: String(err?.message || err) },
      { status: 400 }
    );
  }
}
