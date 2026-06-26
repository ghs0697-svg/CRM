import { getQuizStats } from "@/lib/quiz";
import styles from "./quiz.module.css";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function Card({ label, value }) {
  return (
    <div className={styles.card}>
      <div className={styles.cardValue}>{value}</div>
      <div className={styles.cardLabel}>{label}</div>
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

export default async function QuizPage() {
  let data = null;
  let err = null;
  try { data = await getQuizStats(); } catch (e) { err = String(e?.message || e); }

  const fonteMax = data ? Math.max(1, ...data.porFonte.map((x) => x.pct)) : 1;
  const diaMax = data ? Math.max(1, ...data.porDia.map((x) => x.count)) : 1;

  return (
    <div className={styles.container}>
      <main className={styles.main}>
        <header className={styles.header}>
          <div className={styles.breadcrumb}>
            <span>Workstream GH</span> <span>›</span> <strong>Quiz</strong>
          </div>
          {err && <div className={styles.errorBanner}>Erro ao carregar o quiz: {err}</div>}
        </header>

        <div className={styles.body}>
          {data && (
            <>
              <div className={styles.cards}>
                <Card label="Iniciaram o quiz" value={data.iniciaram.toLocaleString("pt-BR")} />
                <Card label="Chegaram no resultado" value={data.concluiram.toLocaleString("pt-BR")} />
                <Card label="Taxa de conclusão" value={`${data.taxaConclusao.toFixed(1).replace(".", ",")}%`} />
                <Card label="Clicou no WhatsApp" value={`${data.waCount.toLocaleString("pt-BR")} (${data.conversaoWa.toFixed(1).replace(".", ",")}%)`} />
              </div>

              <Section title="Funil do quiz (modelo atual)">
                {data.funil.map((f) => (
                  <Bar key={f.key} label={f.label} count={f.sessoes} pct={f.pct} max={100} />
                ))}
              </Section>

              <Section title="Por fonte">
                {data.porFonte.map((f) => (
                  <Bar key={f.fonte} label={f.fonte} count={f.count} pct={f.pct} max={fonteMax} />
                ))}
              </Section>

              {data.outrasLandings?.length > 0 && (
                <Section title="Outras landings (fora do quiz)">
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
                      <thead>
                        <tr style={{ textAlign: "left", opacity: 0.6 }}>
                          <th style={{ padding: "6px 8px" }}>Landing</th>
                          <th style={{ padding: "6px 8px" }}>Métrica</th>
                          <th style={{ padding: "6px 8px", textAlign: "right" }}>Total</th>
                          <th style={{ padding: "6px 8px", textAlign: "right" }}>Últimos 7d</th>
                          <th style={{ padding: "6px 8px" }}>Top fontes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.outrasLandings.map((l) => (
                          <tr key={l.tag} style={{ borderTop: "1px solid rgba(128,128,128,0.2)" }}>
                            <td style={{ padding: "6px 8px", fontWeight: 600 }}>{l.label}</td>
                            <td style={{ padding: "6px 8px", opacity: 0.7 }}>{l.metrica}</td>
                            <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 700 }}>{l.total.toLocaleString("pt-BR")}</td>
                            <td style={{ padding: "6px 8px", textAlign: "right" }}>{l.ult7d.toLocaleString("pt-BR")}</td>
                            <td style={{ padding: "6px 8px", opacity: 0.8 }}>{l.fontes.map((f) => `${f.fonte} ${f.count}`).join(" · ")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Section>
              )}

              <Section title="Sessões novas por dia (últimos 30)">
                <div className={styles.days}>
                  {data.porDia.map((d) => (
                    <div key={d.dia} className={styles.day} title={`${d.dia}: ${d.count} sessões`}>
                      <span className={styles.dayCount}>{d.count}</span>
                      <div className={styles.dayBar} style={{ height: `${Math.max(4, Math.round((d.count / diaMax) * 100))}%` }} />
                    </div>
                  ))}
                </div>
                {data.porDia.length > 0 && (
                  <div className={styles.daysAxis}>
                    {data.porDia[0].dia} → {data.porDia[data.porDia.length - 1].dia}
                  </div>
                )}
              </Section>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
