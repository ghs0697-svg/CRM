import { NextResponse } from "next/server";
import {
  addSlot,
  removeSlot,
  isAdminAuthorized,
  getProfessional,
} from "@/lib/booking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/booking/admin/availability
 *
 * Profissional cadastra um slot de disponibilidade. Pode mandar 1 ou
 * vários slots de uma vez.
 *
 * AUTH: header `Authorization: Bearer <BOOKING_ADMIN_SECRET>` ou ?secret=
 *
 * Body (1 slot):
 *   { professionalId, date: "YYYY-MM-DD", start: "HH:MM", end: "HH:MM" }
 *
 * Body (vários slots):
 *   { professionalId, slots: [{ date, start, end }, ...] }
 *
 * Resposta: { ok: true, added: [...], errors: [...] }
 */
export async function POST(req) {
  if (!isAdminAuthorized(req)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 }
    );
  }

  let body;
  try { body = await req.json(); } catch {
    return NextResponse.json(
      { ok: false, error: "body deve ser JSON" },
      { status: 400 }
    );
  }

  const { professionalId } = body;
  if (!professionalId) {
    return NextResponse.json(
      { ok: false, error: "professionalId é obrigatório" },
      { status: 400 }
    );
  }
  const prof = getProfessional(professionalId);
  if (!prof) {
    return NextResponse.json(
      { ok: false, error: "profissional não encontrado" },
      { status: 404 }
    );
  }

  // Suporta single OU array de slots
  const slotsToAdd = Array.isArray(body.slots)
    ? body.slots
    : [{ date: body.date, start: body.start, end: body.end }];

  const added = [];
  const errors = [];
  for (const s of slotsToAdd) {
    if (!s.date || !s.start || !s.end) {
      errors.push({ slot: s, error: "date/start/end obrigatórios" });
      continue;
    }
    try {
      const r = await addSlot(professionalId, s);
      added.push(r);
    } catch (err) {
      errors.push({ slot: s, error: String(err?.message || err) });
    }
  }

  return NextResponse.json({ ok: true, added, errors });
}

/**
 * DELETE /api/booking/admin/availability?professionalId=X&date=Y&slotId=Z
 *
 * Remove um slot (só permite se ainda for `available`).
 */
export async function DELETE(req) {
  if (!isAdminAuthorized(req)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 }
    );
  }
  const url = new URL(req.url);
  const professionalId = url.searchParams.get("professionalId");
  const date = url.searchParams.get("date");
  const slotId = url.searchParams.get("slotId");

  if (!professionalId || !date || !slotId) {
    return NextResponse.json(
      { ok: false, error: "professionalId, date e slotId obrigatórios" },
      { status: 400 }
    );
  }

  const result = await removeSlot(professionalId, date, slotId);
  return NextResponse.json(result, { status: result.ok ? 200 : 409 });
}
