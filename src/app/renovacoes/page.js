import { getRenovacoes } from "@/lib/renovacoes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const fmt = (n) => Number(n || 0).toLocaleString("pt-BR");

function Card({ label, value, cor }) {
  return (
    <div style={{ flex: "1 1 140px", minWidth: 140, border: "1px solid rgba(128,128,128,0.25)", borderRadius: 12, padding: "0.8rem 1rem" }}>
      <div style={{ fontSize: "1.6rem", fontWeight: 500, color: cor || "inherit" }}>{value}</div>
      <div style={{ fontSize: "0.85rem", opacity: 0.7 }}>{label}</div>
    </div>
  );
}

function Wa({ tel, nome }) {
  if (!tel) return <span style={{ opacity: 0.4 }}>—</span>;
  const msg = encodeURIComponent(`Olá ${String(nome || "").split(" ")[0]}, tudo bem?`);
  return <a href={`https://wa.me/${tel}?text=${msg}`} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>💬 WhatsApp</a>;
}

function venceEmLabel(d) {
  if (d == null) return "—";
  if (d < 0) return `venceu há ${Math.abs(d)}d`;
  if (d === 0) return "vence hoje";
  return `vence em ${d}d`;
}
function dataBR(iso) { const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : "—"; }

const th = { padding: "6px 8px", textAlign: "left", opacity: 0.6, fontWeight: 500 };
const td = { padding: "6px 8px", borderTop: "1px solid rgba(128,128,128,0.18)" };

export default async function RenovacoesPage() {
  let data = null, err = null;
  try { data = await getRenovacoes(); } catch (e) { err = String(e?.message || e); }

  const SIT = {
    cobrar: { label: "Cobrar", cor: "#e24b4a", bg: "rgba(226,75,74,0.12)" },
    renovou: { label: "Renovou ✓", cor: "#1d9e75", bg: "transparent" },
    cancelou: { label: "Cancelou", cor: "#888", bg: "transparent" },
  };

  return (
    <div style={{ padding: "1.2rem 1.4rem", maxWidth: 1100 }}>
      <div style={{ fontSize: "0.85rem", opacity: 0.6, marginBottom: "0.4rem" }}>Workstream GH › <strong>Renovações</strong></div>
      <h1 style={{ fontSize: "1.4rem", fontWeight: 500, margin: "0 0 0.25rem" }}>Renovações — Raio-X</h1>
      <p style={{ fontSize: "0.9rem", opacity: 0.7, margin: "0 0 1rem" }}>Quem está pra receber o Raio-X e quem já recebeu, pra cobrar renovação de quem não respondeu.</p>

      {err && <div style={{ background: "rgba(226,75,74,0.12)", border: "1px solid #e24b4a", color: "#e24b4a", borderRadius: 8, padding: "0.6rem 0.9rem", marginBottom: "1rem" }}>Erro: {err}</div>}

      {data && (
        <>
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginBottom: "1.4rem" }}>
            <Card label="Na fila (vão receber)" value={fmt(data.fila.length)} />
            <Card label="Já receberam" value={fmt(data.jaReceberam.length)} />
            <Card label="Pra cobrar (não renovaram)" value={fmt(data.aCobrar)} cor={data.aCobrar > 0 ? "#e24b4a" : undefined} />
          </div>

          <h2 style={{ fontSize: "1.05rem", fontWeight: 500, margin: "0 0 0.5rem" }}>⏳ Fila — vão receber o Raio-X (próximos {35} dias)</h2>
          <div style={{ overflowX: "auto", marginBottom: "1.6rem" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
              <thead><tr><th style={th}>Aluno</th><th style={th}>Vencimento</th><th style={th}>Quando</th><th style={th}>Contato</th></tr></thead>
              <tbody>
                {data.fila.length === 0 && <tr><td style={{ ...td, opacity: 0.5 }} colSpan={4}>Ninguém na janela agora.</td></tr>}
                {data.fila.map((r, i) => (
                  <tr key={i}>
                    <td style={{ ...td, fontWeight: 500 }}>{r.nome}</td>
                    <td style={td}>{r.venc}</td>
                    <td style={{ ...td, color: r.diasProVenc <= 7 ? "#ba7517" : "inherit" }}>{venceEmLabel(r.diasProVenc)}</td>
                    <td style={td}><Wa tel={r.wa} nome={r.nome} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2 style={{ fontSize: "1.05rem", fontWeight: 500, margin: "0 0 0.5rem" }}>✅ Já receberam o Raio-X <span style={{ fontWeight: 400, opacity: 0.6, fontSize: "0.85rem" }}>(cobrar em destaque)</span></h2>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
              <thead><tr><th style={th}>Situação</th><th style={th}>Aluno</th><th style={th}>Recebeu em</th><th style={th}>Vencimento</th><th style={th}>Contato</th></tr></thead>
              <tbody>
                {data.jaReceberam.length === 0 && <tr><td style={{ ...td, opacity: 0.5 }} colSpan={5}>Nenhum Raio-X registrado ainda.</td></tr>}
                {data.jaReceberam.map((r, i) => {
                  const st = SIT[r.situacao] || SIT.cancelou;
                  const dim = r.situacao !== "cobrar";
                  return (
                    <tr key={i} style={{ background: st.bg, opacity: dim ? 0.55 : 1 }}>
                      <td style={td}><span style={{ color: st.cor, fontWeight: 500 }}>{st.label}</span></td>
                      <td style={{ ...td, fontWeight: dim ? 400 : 500 }}>{r.nome}</td>
                      <td style={td}>{dataBR(r.enviadoEm)}</td>
                      <td style={td}>{r.venc} <span style={{ opacity: 0.6 }}>({venceEmLabel(r.diasProVenc)})</span></td>
                      <td style={td}><Wa tel={r.wa} nome={r.nome} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p style={{ fontSize: "0.8rem", opacity: 0.55, marginTop: "0.8rem" }}>
            Fila = ativos vencendo nos próximos {35} dias que ainda não receberam. “Recebeu em” vem do log do operário do Raio-X (atualiza de hora em hora). “Renovou” = o vencimento foi empurrado pra frente depois do envio. Vencimento pelo protocolo (com fallback pela compra).
          </p>
        </>
      )}
    </div>
  );
}
