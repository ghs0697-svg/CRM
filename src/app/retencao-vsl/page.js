import { getVslRetencao } from "@/lib/retencao-vsl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const fmt = (n) => Number(n || 0).toLocaleString("pt-BR");
const pct = (n) => `${Number(n || 0).toFixed(1).replace(".", ",")}%`;

function Curva({ vsl }) {
  const alvoQueda = vsl.maiorQueda?.para; // marca logo depois do maior degrau
  return (
    <div style={{ border: "1px solid rgba(128,128,128,0.25)", borderRadius: 12, padding: "1rem 1.1rem", marginBottom: "1.1rem" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: "1.05rem", fontWeight: 600 }}>{vsl.label}</div>
          <div style={{ fontSize: "0.82rem", opacity: 0.6 }}>{vsl.contexto}</div>
        </div>
        <div style={{ fontSize: "0.9rem", textAlign: "right" }}>
          <strong>{fmt(vsl.play)}</strong> deram play · <strong>{fmt(vsl.assistiuTudo)}</strong> até o fim ({pct(vsl.pctAssistiuTudo)})
        </div>
      </div>

      {vsl.play > 0 && vsl.maiorQueda && vsl.maiorQueda.dropPct > 0 && (
        <div style={{ background: "rgba(226,75,74,0.1)", border: "1px solid rgba(226,75,74,0.35)", borderRadius: 8, padding: "0.45rem 0.7rem", margin: "0.7rem 0 0.3rem", fontSize: "0.85rem" }}>
          Maior queda entre <strong>{vsl.maiorQueda.de}</strong> e <strong>{vsl.maiorQueda.para}</strong> (perdeu {vsl.maiorQueda.dropPct.toFixed(0)} pontos). É o trecho pra rever.
        </div>
      )}

      <div style={{ marginTop: "0.7rem" }}>
        {vsl.play === 0 && <div style={{ opacity: 0.5, fontSize: "0.88rem" }}>Ninguém deu play ainda nessa VSL.</div>}
        {vsl.play > 0 && vsl.curva.map((c) => {
          const isAlvo = c.marca === alvoQueda && vsl.maiorQueda.dropPct > 0;
          return (
            <div key={c.marca} style={{ display: "flex", alignItems: "center", gap: "0.6rem", margin: "3px 0" }}>
              <span style={{ width: 70, fontSize: "0.82rem", opacity: 0.75, textAlign: "right", fontWeight: c.nivel === 0 || c.nivel === 10 ? 600 : 400 }}>{c.marca}</span>
              <div style={{ flex: 1, height: 16, background: "rgba(128,128,128,0.15)", borderRadius: 4, overflow: "hidden" }}>
                <div style={{ width: `${Math.max(1, c.pct)}%`, height: "100%", background: isAlvo ? "#e24b4a" : "#4a7fe2", borderRadius: 4 }} />
              </div>
              <span style={{ width: 92, fontSize: "0.82rem", textAlign: "right" }}>
                {fmt(c.sessoes)} <em style={{ opacity: 0.6 }}>({pct(c.pct)})</em>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default async function RetencaoVslPage() {
  let data = null, err = null;
  try { data = await getVslRetencao(); } catch (e) { err = String(e?.message || e); }

  return (
    <div style={{ padding: "1.2rem 1.4rem", maxWidth: 900 }}>
      <div style={{ fontSize: "0.85rem", opacity: 0.6, marginBottom: "0.4rem" }}>Workstream GH › <strong>Retenção VSL</strong></div>
      <h1 style={{ fontSize: "1.4rem", fontWeight: 500, margin: "0 0 0.25rem" }}>Retenção das VSLs</h1>
      <p style={{ fontSize: "0.9rem", opacity: 0.7, margin: "0 0 1.1rem" }}>
        Onde a audiência larga cada vídeo. Cada VSL marca um checkpoint a cada 10% assistido; a curva mostra quantos chegaram em cada ponto. O degrau vermelho é onde mais gente sai, o trecho pra rever.
      </p>

      {err && <div style={{ background: "rgba(226,75,74,0.12)", border: "1px solid #e24b4a", color: "#e24b4a", borderRadius: 8, padding: "0.6rem 0.9rem", marginBottom: "1rem" }}>Erro: {err}</div>}

      {data && data.vsls.map((v) => <Curva key={v.key} vsl={v} />)}

      {data && (
        <p style={{ fontSize: "0.8rem", opacity: 0.55, marginTop: "0.5rem" }}>
          Retenção em X% = sessões que chegaram nesse ponto ÷ sessões que deram play. Medição a cada 10% (o suficiente pra achar o trecho que derruba). Enche conforme o tráfego chega.
        </p>
      )}
    </div>
  );
}
