import { NextResponse } from "next/server";
import { updateStudent, deleteStudent, cancelStudent, pauseStudent } from "@/lib/sheets";
import { auth } from "@/auth";

export const runtime = "nodejs";

// POST /api/alunos/:row  body { action:'cancel'|'uncancel', nome }
// Cancela/reativa o plano escrevendo SÓ a coluna-input "Cancelado em" da mestre.
// O app bloqueia via status (planStatus_). Não apaga nada, é reversível.
export async function POST(req, { params }) {
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
    const body = await req.json().catch(() => ({}));
    const action = body.action;
    let result, verbo;
    if (action === "pause" || action === "resume") {
      result = await pauseStudent(rowNum, body.nome || "", { resume: action === "resume" });
      verbo = action === "resume" ? "retomou" : "pausou";
    } else {
      const uncancel = action === "uncancel";
      result = await cancelStudent(rowNum, body.nome || "", { uncancel });
      verbo = uncancel ? "reativou" : "cancelou";
    }
    console.log(`[POST /api/alunos/${row}] ${session.user.email} ${verbo} "${result.nome}"`);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const c = err?.code;
    const status = c === "ROW_MISMATCH" || c === "ALREADY_PAUSED" ? 409
      : c === "NO_CANCEL_COLUMN" || c === "NO_PAUSE_COLUMN" ? 422
      : 400;
    console.error("[POST /api/alunos/:row] erro:", err);
    return NextResponse.json({ ok: false, error: String(err?.message || err) }, { status });
  }
}

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

// DELETE /api/alunos/:row?nome=<nome> — exclui a linha do aluno na mestre.
// Passa o nome esperado pra confirmar que é a linha certa antes de apagar.
export async function DELETE(req, { params }) {
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
    const nome = new URL(req.url).searchParams.get("nome") || "";
    const result = await deleteStudent(rowNum, nome);
    console.log(`[DELETE /api/alunos/${row}] ${session.user.email} excluiu "${result.deletedName}"`);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const status = err?.code === "ROW_MISMATCH" ? 409 : 400;
    console.error("[DELETE /api/alunos/:row] erro:", err);
    return NextResponse.json(
      { ok: false, error: String(err?.message || err) },
      { status }
    );
  }
}
