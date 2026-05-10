import { NextResponse } from "next/server";
import { getProfessionals, getCredits } from "@/lib/booking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/booking/professionals
 *
 * Lista profissionais ativos com info pública (nome, spec, bio, preços, foto).
 * Se passar ?phone=X, inclui saldo de créditos do aluno por profissional.
 *
 * Resposta: { ok: true, professionals: [...] }
 */
export async function GET(req) {
  const url = new URL(req.url);
  const phone = url.searchParams.get("phone");
  const list = getProfessionals();

  // Não retorna o link Greenn na lista pública (só na hora de reservar).
  // Se tem phone, anexa saldo de créditos pra UI mostrar "tu tem 2 créditos".
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
        pricing: {
          avulso: {
            value: p.pricing.avulso.value,
            label: p.pricing.avulso.label,
          },
          pacote4: {
            value: p.pricing.pacote4.value,
            label: p.pricing.pacote4.label,
            credits: p.pricing.pacote4.credits,
            discountLabel: p.pricing.pacote4.discountLabel,
          },
        },
      };
      if (phone) {
        out.credits = await getCredits(phone, p.id);
      }
      return out;
    })
  );

  return NextResponse.json({ ok: true, professionals: sanitized });
}
