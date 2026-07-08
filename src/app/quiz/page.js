import { getQuizStats } from "@/lib/quiz";
import { getFunilStats } from "@/lib/funil";
import MesFilter from "../_components/MesFilter";
import styles from "./quiz.module.css";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MES_NOMES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const mesLabel = (m) => {
  if (!m || m === "todos") return "Todos os meses";
  const [y, mo] = String(m).split("-");
  return `${MES_NOMES[+mo - 1] || mo}/${y}`;
};

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

export default async function QuizPage({ searchParams }) {
  const sp = (await searchParams) || {};
  const mes = typeof sp.mes === "string" ? sp.mes : undefined;

  let data = null;
  let err = null;
  try { data = await getQuizStats({ mes }); } catch (e) { err = String(e?.message || e); }

  // Leads do /funil (aba PAINEL) no MESMO mês do quiz, pra cruzar dia a dia:
  // Entraram no Whats (Boas Vindas) e Frio (a tag de quem entra). Guardado: se a
  // planilha de leads falhar, a tabela do quiz mostra "—" nessas colunas.
  const leadsPorDia = new Map();
  if (data) {
    try {
      const funil = await getFunilStats(data.mesSel);
      for (const d of funil.recent || []) leadsPorDia.set(d.data, { leads: d.boasVindas, frio: d.frio });
    } catch { /* segue sem o cruzamento */ }
  }

  const fonteMax = data ? Math.max(1, ...data.porFonte.map((x) => x.pct)) : 1;
  const diaMax = data ? Math.max(1, ...data.porDia.map((x) => x.count)) : 1;
  const tabelaDias = data ? [...data.porDia].reverse() : []; // mais recente primeiro, igual /funil

  return (
    <div className={styles.container}>
      <main className={styles.main}>
        <header className={styles.header}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
            <div className={styles.breadcrumb}>
              <span>Workstream GH</span> <span>›</span> <strong>Quiz</strong>
            </div>
            {data && <MesFilter meses={data.meses} mesSel={data.mesSel} base="/quiz" />}
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

              <p style={{ fontSize: "0.85rem", opacity: 0.65, margin: "0 0 0.25rem" }}>
                Período: <strong>{mesLabel(data.mesSel)}</strong>
              </p>

              <Section title={data.mesSel === "todos" ? "Por dia (últimos 30) — quiz × entrada no Whats" : `Dias de ${mesLabel(data.mesSel)} — quiz × entrada no Whats`}>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
                    <thead>
                      <tr style={{ textAlign: "left", opacity: 0.6 }}>
                        <th style={{ padding: "6px 8px" }}>Data</th>
                        <th style={{ padding: "6px 8px" }}>Dia</th>
                        <th style={{ padding: "6px 8px", textAlign: "right" }}>Iniciaram o quiz</th>
                        <th style={{ padding: "6px 8px", textAlign: "right" }}>Concluíram</th>
                        <th style={{ padding: "6px 8px", textAlign: "right" }}>Clicou WhatsApp</th>
                        <th style={{ padding: "6px 8px", textAlign: "right" }}>Entraram no Whats</th>
                        <th style={{ padding: "6px 8px", textAlign: "right" }}>Frio</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tabelaDias.map((d) => {
                        const lead = leadsPorDia.get(d.dia);
                        return (
                          <tr key={d.dia} style={{ borderTop: "1px solid rgba(128,128,128,0.2)" }}>
                            <td style={{ padding: "6px 8px" }}>{d.dia}</td>
                            <td style={{ padding: "6px 8px", opacity: 0.7 }}>{d.semana}</td>
                            <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 700 }}>{d.count.toLocaleString("pt-BR")}</td>
                            <td style={{ padding: "6px 8px", textAlign: "right" }}>{d.concluiram.toLocaleString("pt-BR")}</td>
                            <td style={{ padding: "6px 8px", textAlign: "right" }}>{d.wa.toLocaleString("pt-BR")}</td>
                            <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 700 }}>{lead ? lead.leads.toLocaleString("pt-BR") : "—"}</td>
                            <td style={{ padding: "6px 8px", textAlign: "right" }}>{lead ? lead.frio.toLocaleString("pt-BR") : "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p style={{ fontSize: "0.8rem", opacity: 0.6, marginTop: "0.5rem" }}>
                  Quiz por dia de início da sessão. “Entraram no Whats” e “Frio” vêm da mesma aba do /funil (Boas Vindas e tag Frio do dia) pra fechar a conta quiz → WhatsApp no mesmo lugar.
                </p>
              </Section>

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

              <Section title={data.mesSel === "todos" ? "Sessões novas por dia (últimos 30)" : `Sessões novas por dia (${mesLabel(data.mesSel)})`}>
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
