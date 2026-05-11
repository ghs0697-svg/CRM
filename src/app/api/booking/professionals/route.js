import { NextResponse } from "next/server";
import { getProfessionals, getCreditsDetail } from "@/lib/booking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/booking/professionals?phone=<phone>
 *
 * Lista profissionais ativos com info pública (nome, spec, bio, planos, foto).
 * Se passar ?phone=X, inclui saldo + expiração de créditos por profissional.
 *
 * Não retorna o link Greenn na lista pública (só na hora de reservar via
 * endpoint /reserve, depois de confirmar plano + slot).
 *
 * Resposta: { ok: true, professionals: [...] }
 */
export async function GET(req) {
  const url = new URL(req.url);
  const phone = url.searchParams.get("phone");
  const list = getProfessionals();

  const sanitized = await Promise.all(
    list.map(async (p) => {
      const out = {
        id: p.id,
        name: p.name,
        spec: p.spec,
        bio: p.bio,
        durationMin: p.durationMin,
        weeklySlots: p.weeklySlots,
        photo: p.photo,
        plans: p.plans.map((plan) => ({
          id: plan.id,
          sessions: plan.sessions,
          value: plan.value,
          perSession: plan.perSession,
          label: plan.label,
          discountLabel: plan.discountLabel || null,
          available: !!plan.greennLink, // true se já tem Greenn configurado
        })),
      };
      if (phone) {
        out.credits = await getCreditsDetail(phone, p.id);
      }
      return out;
    })
  );

  return NextResponse.json({ ok: true, professionals: sanitized });
}
