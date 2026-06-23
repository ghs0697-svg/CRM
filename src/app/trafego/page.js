import { getTrafegoStats } from "@/lib/trafego";
import styles from "./trafego.module.css";

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

const money = (n) => "R$ " + Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const money2 = (n) => "R$ " + Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt = (n) => Number(n || 0).toLocaleString("pt-BR");
const roasTxt = (n) => Number(n || 0).toFixed(2).replace(".", ",");
const pct = (n) => Number(n || 0).toFixed(1).replace(".", ",") + "%";

function dataBR(iso) {
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}` : iso;
}

export default async function TrafegoPage() {
  let data = null, err = null;
  try { data = await getTrafegoStats(); } catch (e) { err = String(e?.message || e); }

  return (
    <div className={styles.container}>
      <main className={styles.main}>
        <header className={styles.header}>
          <div className={styles.breadcrumb}>
            <span>Workstream GH</span> <span>›</span> <strong>Tráfego</strong>
          </div>
          {err && (
            <div className={styles.errorBanner}>
              Erro ao carregar o tráfego: {err}
              {/permission|not have access|403|404/i.test(err) && (
                <> — compartilhe a planilha de tráfego com o service account do CRM (claude-webfit@consultoria-gh.iam.gserviceaccount.com).</>
              )}
            </div>
          )}
        </header>

        <div className={styles.body}>
          {data && data.produtos.length === 0 && !err && (
            <p className={styles.insight}>Nenhum dado no último snapshot da planilha de tráfego.</p>
          )}

          {data && data.produtos.map((p) => {
            const t = p.total;
            return (
              <div key={p.nome}>
                <h2 className={styles.prodTitle}>{p.nome}</h2>

                <div className={styles.cards}>
                  <Card label="Investido" value={money(t.gasto)} />
                  <Card label="Vendas (Meta)" value={fmt(t.vendas)} sub={`${fmt(t.cliques)} cliques`} />
                  <Card label="Receita (Meta)" value={money(t.receita)} />
                  <Card label="ROAS geral" value={roasTxt(t.roas)} sub={t.roas >= 1 ? "lucro" : "prejuízo"} />
                </div>

                <p className={styles.insight}>
                  {p.topVendas && <>🏆 <strong>{p.topVendas}</strong> é quem mais converte (escala esse). </>}
                  {p.topRoas && p.topRoas !== p.topVendas && <>💙 <strong>{p.topRoas}</strong> tem o melhor ROAS. </>}
                  {p.queimaGrana && <>🔴 <strong>{p.queimaGrana}</strong> traz muito clique mas converte mal (ROAS &lt; 1, queima grana).</>}
                </p>

                <Section title="Por criativo (último snapshot)">
                  <div className={styles.tableWrap}>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th>Criativo</th>
                          <th className={styles.num}>Cliques</th>
                          <th className={styles.num}>Vendas</th>
                          <th className={styles.num}>Conv.</th>
                          <th className={styles.num}>Receita</th>
                          <th className={styles.num}>Investido</th>
                          <th className={styles.num}>CPA</th>
                          <th className={styles.num}>ROAS</th>
                        </tr>
                      </thead>
                      <tbody>
                        {p.criativos.map((c) => (
                          <tr key={c.nome} className={c.nome === p.topVendas ? styles.winRow : ""}>
                            <td>
                              {c.nome}
                              {c.nome === p.topVendas && <span className={`${styles.badge} ${styles.badgeWin}`}>vencedor</span>}
                              {c.nome === p.topRoas && c.nome !== p.topVendas && <span className={`${styles.badge} ${styles.badgeRoas}`}>melhor ROAS</span>}
                              {c.nome === p.queimaGrana && <span className={`${styles.badge} ${styles.badgeBurn}`}>queima grana</span>}
                            </td>
                            <td className={styles.num}>{fmt(c.cliques)}</td>
                            <td className={styles.num}><strong>{fmt(c.vendas)}</strong></td>
                            <td className={styles.num}>{pct(c.conv)}</td>
                            <td className={styles.num}>{money(c.receita)}</td>
                            <td className={styles.num}>{money(c.gasto)}</td>
                            <td className={styles.num}>{c.vendas ? money2(c.cpa) : "—"}</td>
                            <td className={`${styles.num} ${c.roas >= 1 ? styles.roasPos : styles.roasNeg}`}>{roasTxt(c.roas)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Section>

                {p.dias.length > 0 && (
                  <Section title="Por dia (últimos 30)">
                    <div className={styles.tableWrap}>
                      <table className={styles.table}>
                        <thead>
                          <tr>
                            <th>Dia</th>
                            <th className={styles.num}>Investido</th>
                            <th className={styles.num}>Vendas</th>
                            <th className={styles.num}>Receita</th>
                            <th className={styles.num}>ROAS</th>
                          </tr>
                        </thead>
                        <tbody>
                          {p.dias.map((d) => (
                            <tr key={d.data}>
                              <td>{dataBR(d.data)}</td>
                              <td className={styles.num}>{money(d.gasto)}</td>
                              <td className={styles.num}><strong>{fmt(d.vendas)}</strong></td>
                              <td className={styles.num}>{money(d.receita)}</td>
                              <td className={`${styles.num} ${d.roas >= 1 ? styles.roasPos : styles.roasNeg}`}>{roasTxt(d.roas)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Section>
                )}
              </div>
            );
          })}

          {data?.atualizado && (
            <p className={styles.atualizado}>Atualizado: {String(data.atualizado).replace("T", " ").slice(0, 16)} · a planilha é alimentada automaticamente.</p>
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
