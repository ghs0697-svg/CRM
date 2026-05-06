import { NextResponse } from "next/server";
import { getStudents } from "@/lib/db";

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
