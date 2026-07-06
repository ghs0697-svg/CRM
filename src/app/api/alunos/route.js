import { NextResponse } from "next/server";
import { getStudents, appendStudent, getNotasSuporte, phoneSuffixMatch, getLastWorkouts } from "@/lib/sheets";
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
    // Último treino registrado pelo app (aba LOGS) — base do alerta de sumido
    const lastWorkouts = await getLastWorkouts().catch((e) => {
      console.error("[/api/students] LOGS:", e);
      return new Map();
    });
    const hoje = Date.now();
    const hojeMeiaNoite = new Date(); hojeMeiaNoite.setHours(0, 0, 0, 0);
    const enriched = students.map((s) => {
      const insight = getInsight(s.contato);
      const nota = notas.find((n) => phoneSuffixMatch(s.contato, n.digits));
      const out = { ...s };

      // Vencimento pelo PROTOCOLO (col AB, contrato Sala #512): estica pelo gap
      // compra->entrega. Fallback pra col J (compra) enquanto a coluna não existe
      // ou vem vazia. Date-validated pra não exibir lixo se a coluna vier desalinhada.
      const vp = String(s.vencimentoProtocolo || "").trim();
      const mvp = vp.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      out.dataVencimentoCompra = s.dataVencimento; // preserva a base compra (col J)
      if (mvp) {
        out.dataVencimento = vp;
        const vd = new Date(+mvp[3], +mvp[2] - 1, +mvp[1]);
        const p = (n) => String(n).padStart(2, "0");
        // Contato p/ renovação = 1 mês antes do venc-protocolo. As colunas-fórmula
        // L/N do mestre seguem J-based (compra) de propósito (#512/#527); aqui o
        // painel exibe tudo no calendário do PROTOCOLO pra não contradizer o venc/status.
        const cd = new Date(vd); cd.setMonth(cd.getMonth() - 1);
        out.dataContatoRenovacaoCompra = s.dataContatoRenovacao;
        out.dataContatoRenovacao = `${p(cd.getDate())}/${p(cd.getMonth() + 1)}/${cd.getFullYear()}`;
        // Reativação pelo protocolo: quem estava "Vencido" só pela data de compra
        // mas o vencimento pelo protocolo ainda é futuro volta a "Ativo" (#512), e
        // a ação "Plano Vencido!" (col N, J-based) vira "OK" pra não contradizer.
        if (s.statusPlano === "Vencido" && vd >= hojeMeiaNoite) {
          out.statusPlanoMestre = s.statusPlano; out.statusPlano = "Ativo";
          out.acaoNecessariaMestre = s.acaoNecessaria;
          if (String(s.acaoNecessaria || "").toLowerCase().includes("vencid")) out.acaoNecessaria = "OK";
        }
      }

      if (insight) out.insight = insight;
      if (nota) out.notaSuporte = { nota: nota.nota, atualizado: nota.atualizado };
      const sid = (String(s.linkSite || "").match(/[?&]sheet=([\w-]+)/) || [])[1];
      const lw = sid ? lastWorkouts.get(sid) : null;
      if (lw) {
        out.ultimoTreino = lw;
        out.diasSemTreino = Math.max(0, Math.floor((hoje - new Date(lw + "T12:00:00").getTime()) / 86400000));
      }
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
