import { getFunilStats } from "@/lib/funil";
import styles from "./funil.module.css";

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

export default async function FunilPage() {
  let data = null;
  let err = null;
  try { data = await getFunilStats(); } catch (e) { err = String(e?.message || e); }

  const t = data?.totals;

  return (
    <div className={styles.container}>
      <main className={styles.main}>
        <header className={styles.header}>
          <div className={styles.breadcrumb}>
            <span>Workstream GH</span> <span>›</span> <strong>Funil</strong>
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

              <Section title="Temperatura (% do total de leads)">
                <Bar label="Frio" count={t.frio} pct={t.boasVindas ? Math.round((t.frio / t.boasVindas) * 1000) / 10 : 0} max={100} />
                <Bar label="Morno" count={t.morno} pct={t.pctMorno} max={100} />
                <Bar label="Quente" count={t.quente} pct={t.pctQuente} max={100} />
                <Bar label="Link" count={t.link} pct={t.pctLink} max={100} />
              </Section>

              <Section title="Últimos 30 dias">
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
