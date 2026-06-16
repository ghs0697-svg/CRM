import { getEngajamentoStats } from "@/lib/engajamento";
import styles from "./engajamento.module.css";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const fmt = (n) => Number(n || 0).toLocaleString("pt-BR");

function Card({ label, value, sub }) {
  return (
    <div className={styles.card}>
      <div className={styles.cardValue}>{value}</div>
      <div className={styles.cardLabel}>{label}</div>
      {sub != null && <div className={styles.cardSub}>{sub}</div>}
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

export default async function EngajamentoPage() {
  let data = null;
  let err = null;
  try { data = await getEngajamentoStats(); } catch (e) { err = String(e?.message || e); }

  const diaMax = data ? Math.max(1, ...data.porDia.map((x) => x.count)) : 1;
  const pctAtivos = data && data.totalAlunos ? Math.round((data.ativos7 / data.totalAlunos) * 100) : 0;

  return (
    <div className={styles.container}>
      <main className={styles.main}>
        <header className={styles.header}>
          <div className={styles.breadcrumb}>
            <span>Workstream GH</span> <span>›</span> <strong>Engajamento</strong>
          </div>
          {err && <div className={styles.errorBanner}>Erro: {err}</div>}
        </header>

        <div className={styles.body}>
          {data && (
            <>
              <div className={styles.cards}>
                <Card label="Treinaram (7 dias)" value={fmt(data.ativos7)} sub={`${pctAtivos}% dos que já treinaram`} />
                <Card label="Treinaram (30 dias)" value={fmt(data.ativos30)} />
                <Card label="Treinos (30 dias)" value={fmt(data.treinos30)} />
                <Card label="Frequência média" value={`${data.freqMedia.toString().replace(".", ",")}x/sem`} />
              </div>

              <Section title={`⚠️ Em risco — pararam de treinar (10 a 45 dias) · ${data.emRisco.length}`}>
                {data.emRisco.length === 0 && <div className={styles.empty}>Ninguém em risco no momento 🎉</div>}
                {data.emRisco.length > 0 && (
                  <div className={styles.tableWrap}>
                    <table className={styles.table}>
                      <thead>
                        <tr><th>Aluno</th><th>Sem treinar</th><th>Total dias</th><th>Recorde</th></tr>
                      </thead>
                      <tbody>
                        {data.emRisco.map((a) => (
                          <tr key={a.sid}>
                            <td>{a.nome}</td>
                            <td><strong className={styles.risk}>{a.diasSemTreinar}d</strong></td>
                            <td>{fmt(a.totalDias)}</td>
                            <td>{fmt(a.recorde)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Section>

              <Section title="🏆 Mais consistentes (total de dias treinados)">
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr><th>#</th><th>Aluno</th><th>Total dias</th><th>Streak atual</th><th>Recorde</th><th>Última</th></tr>
                    </thead>
                    <tbody>
                      {data.ranking.map((a, i) => (
                        <tr key={a.sid}>
                          <td>{i + 1}</td>
                          <td>{a.nome}</td>
                          <td><strong>{fmt(a.totalDias)}</strong></td>
                          <td>{fmt(a.streak)}</td>
                          <td>{fmt(a.recorde)}</td>
                          <td className={a.diasSemTreinar <= 7 ? styles.ok : styles.muted}>
                            {a.diasSemTreinar === 0 ? "hoje" : `${a.diasSemTreinar}d`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Section>

              <Section title="Treinos por dia (últimos 30)">
                <div className={styles.days}>
                  {data.porDia.map((d) => (
                    <div key={d.dia} className={styles.day} title={`${d.dia}: ${d.count} treinos`}>
                      <span className={styles.dayCount}>{d.count}</span>
                      <div className={styles.dayBar} style={{ height: `${Math.max(4, Math.round((d.count / diaMax) * 100))}%` }} />
                      <span className={styles.dayLabel}>{d.dia}</span>
                    </div>
                  ))}
                </div>
              </Section>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
