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
                <Card label="Sessões totais" value={data.totalSessions.toLocaleString("pt-BR")} />
                <Card label="Iniciaram (etapa 1)" value={data.iniciaram.toLocaleString("pt-BR")} />
                <Card label="Concluíram" value={data.concluiram.toLocaleString("pt-BR")} />
                <Card label="Conclusão (de quem iniciou)" value={`${data.taxaConclusao.toFixed(1).replace(".", ",")}%`} />
              </div>

              <Section title={`Funil por etapa (${data.maxEtapa} etapas)`}>
                {data.funil.map((f) => (
                  <Bar key={f.etapa} label={`Etapa ${f.etapa}`} count={f.sessoes} pct={f.pct} max={100} />
                ))}
              </Section>

              <Section title="Por fonte">
                {data.porFonte.map((f) => (
                  <Bar key={f.fonte} label={f.fonte} count={f.count} pct={f.pct} max={fonteMax} />
                ))}
              </Section>

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
