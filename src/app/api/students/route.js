import { NextResponse } from "next/server";
import { getStudents, clearAll, deleteStudentByPhone, upsertStudent, patchFollowUp, updateStudentByPhone } from "@/lib/db";

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
 * POST /api/students — adiciona aluno criado À MÃO na página de Retornos
 * (o webhook do ManyChat tem rota própria). Dedup por telefone via upsert.
 */
export async function POST(req) {
  try {
    const body = await req.json();
    const name = String(body?.name || "").trim();
    const phone = String(body?.phone || "").replace(/\D/g, "");
    if (!name || phone.length < 8) {
      return NextResponse.json({ ok: false, error: "nome e telefone obrigatórios" }, { status: 400 });
    }
    const { student, created } = await upsertStudent({
      id: body.id || Date.now(),
      name, phone,
      subscriberId: null,
      assignmentDate: String(body.assignmentDate || "").slice(0, 10),
      seller: body.seller || "Manual",
      observations: String(body.observations || ""),
      followUps: Array.isArray(body.followUps) ? body.followUps : [],
      source: "manual",
    });
    return NextResponse.json({ ok: true, student, created });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err?.message || err) },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/students — persiste mudanças da página de Retornos no servidor
 * (antes viviam só no localStorage e sumiam ao limpar o cache).
 *   { action: "followup", phone, tag, patch: {status,outcome,calledAt}, log? }
 *   { action: "edit", oldPhone, name?, phone?, observations? }
 */
export async function PATCH(req) {
  try {
    const body = await req.json();
    if (body?.action === "followup") {
      const st = await patchFollowUp(body.phone, body.tag, body.patch || {}, body.log || null);
      return NextResponse.json({ ok: true, found: !!st });
    }
    if (body?.action === "edit") {
      const st = await updateStudentByPhone(body.oldPhone, body);
      return NextResponse.json({ ok: true, found: !!st });
    }
    return NextResponse.json({ ok: false, error: "action inválida" }, { status: 400 });
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
