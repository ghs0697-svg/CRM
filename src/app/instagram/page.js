import { promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// O dashboard do Instagram é um SNAPSHOT estático (public/instagram.html) gerado
// fora do CRM e commitado de vez em quando. Esta página existe pra deixar a DATA
// do retrato visível (antes o GH abria o html cru achando que era dado vivo).
export default async function InstagramPage() {
  let quando = null;
  try {
    const st = await fs.stat(path.join(process.cwd(), "public", "instagram.html"));
    quando = new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
    }).format(st.mtime);
  } catch { /* sem arquivo: o aviso abaixo cobre */ }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <div style={{ padding: "0.5rem 1rem", fontSize: "0.85rem", background: "rgba(128,128,128,0.08)", borderBottom: "1px solid rgba(128,128,128,0.25)", display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
        <strong>📸 Dashboard Instagram</strong>
        {quando ? (
          <span style={{ opacity: 0.75 }}>Retrato gerado em <strong>{quando}</strong> (não é tempo real; atualiza quando o dashboard é re-exportado).</span>
        ) : (
          <span style={{ color: "#b91c1c" }}>Arquivo do dashboard não encontrado (public/instagram.html).</span>
        )}
        <a href="/instagram.html" target="_blank" rel="noreferrer" style={{ marginLeft: "auto", fontSize: "0.8rem" }}>abrir em tela cheia ↗</a>
      </div>
      <iframe src="/instagram.html" title="Dashboard Instagram" style={{ border: 0, flex: 1, width: "100%" }} />
    </div>
  );
}
