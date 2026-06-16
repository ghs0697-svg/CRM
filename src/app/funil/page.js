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
  const bitlyMax = data ? Math.max(1, ...data.bitly.map((x) => x.cliques)) : 1;

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

              <Section title={`Cliques por fonte (Bitly) — ${fmt(data.bitlyTotal)} total`}>
                {data.bitly.length === 0 && <div className={styles.empty}>Sem dados de Bitly.</div>}
                {data.bitly.map((b) => (
                  <Bar
                    key={b.fonte}
                    label={b.fonte}
                    count={b.cliques}
                    pct={data.bitlyTotal ? Math.round((b.cliques / data.bitlyTotal) * 1000) / 10 : 0}
                    max={data.bitlyTotal ? Math.round((bitlyMax / data.bitlyTotal) * 1000) / 10 : 100}
                  />
                ))}
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
