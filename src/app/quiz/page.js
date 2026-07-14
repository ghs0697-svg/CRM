import { getQuizStats } from "@/lib/quiz";
import { getPeitaoQuizStats } from "@/lib/quiz-peitao";
import { getFunilStats } from "@/lib/funil";
import MesFilter from "../_components/MesFilter";
import VersaoFilter from "../_components/VersaoFilter";
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
  const pv = typeof sp.pv === "string" ? sp.pv : undefined; // versão do quiz Peitão

  let data = null;
  let err = null;
  try { data = await getQuizStats({ mes }); } catch (e) { err = String(e?.message || e); }

  // Funil por etapa do quiz do Peitão (go-live 14/07, Sala #696). Guardado: se falhar,
  // a página do metodogh segue normal.
  let peitao = null;
  try { peitao = await getPeitaoQuizStats({ versao: pv }); } catch { /* segue sem o Peitão */ }

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
                        <th style={{ padding: "6px 8px", textAlign: "right" }}>Iniciaram</th>
                        <th style={{ padding: "6px 8px", textAlign: "right" }}>Chegaram ao final</th>
                        <th style={{ padding: "6px 8px", textAlign: "right" }}>Clicou WhatsApp</th>
                        <th style={{ padding: "6px 8px", textAlign: "right" }}>Entraram (Frio)</th>
                        <th style={{ padding: "6px 8px", textAlign: "right" }}>Final → Frio</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tabelaDias.map((d) => {
                        const lead = leadsPorDia.get(d.dia);
                        const pctFrio = lead && d.concluiram > 0 ? Math.round((lead.frio / d.concluiram) * 100) : null;
                        return (
                          <tr key={d.dia} style={{ borderTop: "1px solid rgba(128,128,128,0.2)" }}>
                            <td style={{ padding: "6px 8px" }}>{d.dia}</td>
                            <td style={{ padding: "6px 8px", opacity: 0.7 }}>{d.semana}</td>
                            <td style={{ padding: "6px 8px", textAlign: "right", opacity: 0.75 }}>{d.count.toLocaleString("pt-BR")}</td>
                            <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 700 }}>{d.concluiram.toLocaleString("pt-BR")}</td>
                            <td style={{ padding: "6px 8px", textAlign: "right" }}>{d.wa.toLocaleString("pt-BR")}</td>
                            <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 700 }}>{lead ? lead.frio.toLocaleString("pt-BR") : "—"}</td>
                            <td style={{ padding: "6px 8px", textAlign: "right", opacity: 0.85 }}>{pctFrio == null ? "—" : `${pctFrio}%`}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p style={{ fontSize: "0.8rem", opacity: 0.6, marginTop: "0.5rem" }}>
                  “Chegaram ao final” = viram o resultado do quiz. “Entraram (Frio)” vem da aba do /funil: só recebe a tag quem MANDA a mensagem no Whats — a diferença entre “Clicou WhatsApp” e “Entraram (Frio)” é quem foi enviado pro Whats e não mandou a mensagem. “Final → Frio” = dos que terminaram o quiz no dia, % que virou lead de verdade.
                </p>
              </Section>

              <Section title="Funil do quiz (modelo atual)">
                {data.funil.map((f) => (
                  <Bar key={f.key} label={f.label} count={f.sessoes} pct={f.pct} max={100} />
                ))}
              </Section>

              {peitao && (
                <>
                  <div style={{ borderTop: "2px solid rgba(128,128,128,0.25)", margin: "1.75rem 0 1rem" }} />
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap", marginBottom: "0.4rem" }}>
                    <h2 className={styles.sectionTitle} style={{ fontSize: "1.15rem", margin: 0 }}>🕊️ Peitão de Pombo — funil do quiz por etapa</h2>
                    {peitao.versoes.length > 1 && <VersaoFilter versoes={peitao.versoes} versaoSel={peitao.versaoSel} base="/quiz" />}
                  </div>
                  <p style={{ fontSize: "0.82rem", opacity: 0.65, margin: "0 0 0.9rem" }}>
                    Versão <strong>{peitao.versaoSel}</strong>{peitao.versaoObs ? ` — ${peitao.versaoObs}` : ""}. Conta só as sessões dessa versão (cada edição do quiz vira uma versão nova; o histórico inteiro fica guardado na planilha). Enche conforme o tráfego chega.
                  </p>

                  <div className={styles.cards}>
                    <Card label="Visitas (desde 14/07)" value={peitao.visitas.toLocaleString("pt-BR")} />
                    <Card label="Começaram o quiz" value={`${peitao.comecaram.toLocaleString("pt-BR")} (${peitao.taxaVisitaComecou.toFixed(1).replace(".", ",")}%)`} />
                    <Card label="Chegaram na oferta" value={peitao.chegaramOferta.toLocaleString("pt-BR")} />
                    <Card label="Clicou em comprar" value={`${peitao.compraram.toLocaleString("pt-BR")} (${peitao.taxaComecouComprou.toFixed(1).replace(".", ",")}%)`} />
                  </div>

                  {peitao.maiorQueda && peitao.comecaram > 0 && (
                    <div style={{ background: "rgba(226,75,74,0.1)", border: "1px solid rgba(226,75,74,0.4)", borderRadius: 8, padding: "0.6rem 0.9rem", margin: "0.5rem 0 1rem", fontSize: "0.9rem" }}>
                      <strong>Maior abandono:</strong> entre <strong>{peitao.maiorQueda.de}</strong> e <strong>{peitao.maiorQueda.label}</strong> — só {peitao.maiorQueda.retencao.toFixed(0)}% seguiram (perdeu {peitao.maiorQueda.queda.toLocaleString("pt-BR")}).
                    </div>
                  )}

                  <Section title="Etapa a etapa (onde o pessoal para)">
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.88rem" }}>
                        <thead>
                          <tr style={{ textAlign: "left", opacity: 0.6 }}>
                            <th style={{ padding: "6px 8px" }}>#</th>
                            <th style={{ padding: "6px 8px" }}>Etapa</th>
                            <th style={{ padding: "6px 8px", textAlign: "right" }}>Sessões</th>
                            <th style={{ padding: "6px 8px", textAlign: "right" }}>% das visitas</th>
                            <th style={{ padding: "6px 8px", textAlign: "right" }}>Retenção</th>
                          </tr>
                        </thead>
                        <tbody>
                          {peitao.funil.map((f) => {
                            const isDrop = peitao.maiorQueda && f.n === peitao.maiorQueda.n && peitao.comecaram > 0;
                            const retCor = f.n === 0 ? "inherit" : f.retencao >= 80 ? "#1d9e75" : f.retencao >= 50 ? "#ba7517" : "#e24b4a";
                            return (
                              <tr key={f.key} style={{ borderTop: "1px solid rgba(128,128,128,0.18)", background: isDrop ? "rgba(226,75,74,0.1)" : "transparent" }}>
                                <td style={{ padding: "6px 8px", opacity: 0.5 }}>n{f.n}</td>
                                <td style={{ padding: "6px 8px", fontWeight: f.n <= 1 ? 600 : 400 }}>{f.label}</td>
                                <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 600 }}>{f.sessoes.toLocaleString("pt-BR")}</td>
                                <td style={{ padding: "6px 8px", textAlign: "right", opacity: 0.8 }}>{f.pctVisitas.toFixed(1).replace(".", ",")}%</td>
                                <td style={{ padding: "6px 8px", textAlign: "right", color: retCor }}>{f.n === 0 ? "—" : `${f.retencao.toFixed(0)}%`}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <p style={{ fontSize: "0.8rem", opacity: 0.6, marginTop: "0.5rem" }}>
                      “Retenção” = % que passou da etapa anterior pra essa (a linha vermelha é o maior gargalo). “Sessões” = quantas pessoas chegaram até aquela etapa. n13 é a VSL do mecanismo, n19 a oferta/preço, n20 o clique em comprar.
                    </p>
                  </Section>

                  {peitao.porFonte.length > 0 && (
                    <Section title="Peitão — por fonte (quem começou o quiz)">
                      {peitao.porFonte.map((f) => (
                        <Bar key={f.fonte} label={f.fonte} count={f.count} pct={f.pct} max={Math.max(1, ...peitao.porFonte.map((x) => x.pct))} />
                      ))}
                    </Section>
                  )}
                </>
              )}

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
