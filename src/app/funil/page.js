import { getFunilStats } from "@/lib/funil";
import MesFilter from "../_components/MesFilter";
import styles from "./funil.module.css";

const MES_NOMES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const mesLabel = (m) => {
  if (!m || m === "todos") return "Todos os meses";
  const [y, mo] = String(m).split("-");
  return `${MES_NOMES[+mo - 1] || mo}/${y}`;
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function Card({ label, value, sub }) {
  return (
    <div className={styles.card}>
      <div className={styles.cardValue}>{value}</div>
      <div className={styles.cardLabel}>{label}</div>
      {sub != null && <div className={styles.cardSub}>{sub}</div>}
    </div>
  );
}

function Bar({ label, count, pct, max }) {
  const w = Math.max(2, Math.round((pct / (max || 100)) * 100));
  return (
    <div className={styles.barRow}>
      <span className={styles.barLabel} title={label}>{label}</span>
      <div className={styles.barTrack}><div className={styles.barFill} style={{ width: `${w}%` }} /></div>
      <span className={styles.barVal}>
        {count.toLocaleString("pt-BR")} <em>({pct.toFixed(1).replace(".", ",")}%)</em>
      </span>
    </div>
  );
}

const fmt = (n) => Number(n || 0).toLocaleString("pt-BR");
const fpct = (n) => `${Number(n || 0).toFixed(1).replace(".", ",")}%`;

// Dias desde a última coleta do Linktree (ts vem como "YYYY-MM-DDTHH:mm..." do coletor).
// null = sem dado. Comparação no fuso de SP pra não inflar 1 dia à noite.
function linktreeIdadeDias(ts) {
  const m = String(ts || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const dias = Math.floor((new Date(`${hoje}T00:00:00`) - new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00`)) / 86400000);
  return Number.isFinite(dias) ? dias : null;
}

export default async function FunilPage({ searchParams }) {
  const sp = (await searchParams) || {};
  const mes = typeof sp.mes === "string" ? sp.mes : undefined;

  let data = null;
  let err = null;
  try { data = await getFunilStats(mes); } catch (e) { err = String(e?.message || e); }

  const t = data?.totals;

  return (
    <div className={styles.container}>
      <main className={styles.main}>
        <header className={styles.header}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
            <div className={styles.breadcrumb}>
              <span>Workstream GH</span> <span>›</span> <strong>Funil</strong>
            </div>
            {data && <MesFilter meses={data.meses} mesSel={data.mesSel} />}
          </div>
          {err && <div className={styles.errorBanner}>Erro ao carregar o funil: {err}</div>}
        </header>

        <div className={styles.body}>
          {data && (
            <>
              <div className={styles.cards}>
                <Card label="Total de leads" value={fmt(t.boasVindas)} />
                <Card label="Chegaram em Morno" value={fmt(t.morno)} sub={fpct(t.pctMorno)} />
                <Card label="Chegaram em Quente" value={fmt(t.quente)} sub={fpct(t.pctQuente)} />
                <Card label="Pegaram o Link" value={fmt(t.link)} sub={fpct(t.pctLink)} />
              </div>

              <p style={{ fontSize: "0.85rem", opacity: 0.65, margin: "0 0 0.25rem" }}>
                Período: <strong>{mesLabel(data.mesSel)}</strong>
              </p>

              {data.safra?.disponivel && (
                <Section title={data.mesSel === "todos" ? "Conversão por safra — de cada 100 que entram" : `Conversão por safra — quem entrou em ${mesLabel(data.mesSel)}`}>
                  <div className={styles.cards} style={{ marginBottom: "0.5rem" }}>
                    <Card label="Entraram" value={fmt(data.safra.resumo.entraram)} />
                    <Card label="Viraram Morno" value={fmt(data.safra.resumo.morno)} sub={fpct(data.safra.resumo.pctMorno)} />
                    <Card label="Viraram Quente" value={fmt(data.safra.resumo.quente)} sub={fpct(data.safra.resumo.pctQuente)} />
                    <Card label="Pegaram o Link" value={fmt(data.safra.resumo.link)} sub={fpct(data.safra.resumo.pctLink)} />
                  </div>
                  <div className={styles.tableWrap}>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th>Entrou em</th><th>Entraram</th><th>→ Morno</th><th>→ Quente</th><th>→ Link</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.safra.dias.map((d) => (
                          <tr key={d.dia}>
                            <td>{d.dia.split("-").reverse().join("/")}</td>
                            <td><strong>{fmt(d.entraram)}</strong></td>
                            <td>{fmt(d.morno)} <em style={{ opacity: 0.6 }}>({fpct(d.pctMorno)})</em></td>
                            <td>{fmt(d.quente)} <em style={{ opacity: 0.6 }}>({fpct(d.pctQuente)})</em></td>
                            <td>{fmt(d.link)} <em style={{ opacity: 0.6 }}>({fpct(d.pctLink)})</em></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p style={{ fontSize: "0.8rem", opacity: 0.6, marginTop: "0.5rem" }}>
                    Deduplicado por lead (1 pessoa = 1 linha, re-entradas colapsam). “Entrou em” = dia do 1º contato; as % são desse grupo que chegou a cada degrau ao longo do tempo, não no mesmo dia. Quente pode passar Morno em safras onde o lead pula etapa (pediu preço direto). Atualiza sozinho de hora em hora.
                  </p>
                </Section>
              )}

              <Section title="Temperatura (% do total de leads)">
                <Bar label="Frio" count={t.frio} pct={t.boasVindas ? Math.round((t.frio / t.boasVindas) * 1000) / 10 : 0} max={100} />
                <Bar label="Morno" count={t.morno} pct={t.pctMorno} max={100} />
                <Bar label="Quente" count={t.quente} pct={t.pctQuente} max={100} />
                <Bar label="Link" count={t.link} pct={t.pctLink} max={100} />
              </Section>

              <Section title={data.mesSel === "todos" ? "Últimos 30 dias" : `Dias de ${mesLabel(data.mesSel)}`}>
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Data</th><th>Dia</th><th>Leads</th><th>Frio</th><th>Morno</th><th>Quente</th><th>Link</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.recent.map((d) => (
                        <tr key={d.data}>
                          <td>{d.data}</td>
                          <td>{d.dia}</td>
                          <td><strong>{fmt(d.boasVindas)}</strong></td>
                          <td>{fmt(d.frio)}</td>
                          <td>{fmt(d.morno)}</td>
                          <td>{fmt(d.quente)}</td>
                          <td>{fmt(d.link)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Section>

              {data.linktree?.length > 0 && (
                <Section title="Linktree — cliques por link">
                  {(() => {
                    const idade = linktreeIdadeDias(data.linktreeAtualizado);
                    if (idade == null || idade < 2) return null;
                    return (
                      <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", color: "#991b1b", borderRadius: 8, padding: "0.6rem 0.9rem", marginBottom: "0.75rem", fontSize: "0.85rem" }}>
                        ⚠️ Coleta do Linktree parada há <strong>{idade} dias</strong> (sessão do tr.ee expirou). Os cliques abaixo estão congelados.
                        Pra reativar, no Mac: <code>node ~/webfit-mcp/linktree/login-linktree.mjs</code>, faz o login e fecha o Chrome; o cron das 05:00 volta sozinho.
                      </div>
                    );
                  })()}
                  <div className={styles.tableWrap}>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th>Link</th><th>Tipo</th><th>Destino</th>
                          <th>24h</th><th>7 dias</th><th>28 dias</th><th>Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.linktree.map((l) => (
                          <tr key={l.id}>
                            <td><strong>{l.label}</strong></td>
                            <td>{l.tipo === "proprio" ? "Página" : "Atendente"}</td>
                            <td>{l.destino}</td>
                            <td>{fmt(l.c24)}</td>
                            <td><strong>{fmt(l.c7)}</strong></td>
                            <td>{fmt(l.c28)}</td>
                            <td>{fmt(l.total)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {data.linktreeAtualizado && (
                    <p style={{ fontSize: "0.8rem", opacity: 0.6, marginTop: "0.5rem" }}>
                      Atualizado: {String(data.linktreeAtualizado).replace("T", " ").slice(0, 16)}. Coletado 1x/dia do tr.ee (links recém-criados ficam em 0; a sessão pode expirar e exigir re-login).
                    </p>
                  )}
                </Section>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      <div className={styles.sectionBody}>{children}</div>
    </section>
  );
}
