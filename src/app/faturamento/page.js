import { getFaturamentoStats } from "@/lib/faturamento";
import MesFilter from "../_components/MesFilter";
import styles from "./faturamento.module.css";

const MES_NOMES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const mesLabel = (m) => {
  if (!m || m === "todos") return "Todos os meses";
  const [y, mo] = String(m).split("-");
  return `${MES_NOMES[+mo - 1] || mo}/${y}`;
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const fmtBRL = (n) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(n || 0);
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
function MoneyBar({ label, value, max }) {
  const w = Math.max(2, Math.round((value / (max || 1)) * 100));
  return (
    <div className={styles.barRow}>
      <span className={styles.barLabel} title={label}>{label}</span>
      <div className={styles.barTrack}><div className={styles.barFill} style={{ width: `${w}%` }} /></div>
      <span className={styles.barVal}>{fmtBRL(value)}</span>
    </div>
  );
}

export default async function FaturamentoPage({ searchParams }) {
  const sp = (await searchParams) || {};
  const mes = typeof sp.mes === "string" ? sp.mes : undefined;

  let data = null;
  let err = null;
  try { data = await getFaturamentoStats(mes); } catch (e) { err = String(e?.message || e); }
  const filtrado = data && data.mesSel !== "todos";

  const mesMax = data ? Math.max(1, ...data.porMes.map((m) => m.receita)) : 1;
  const planoMax = data ? Math.max(1, ...data.planos.map((p) => p.receita)) : 1;
  const catMax = data ? Math.max(1, ...data.categorias.map((c) => c.receita)) : 1;

  return (
    <div className={styles.container}>
      <main className={styles.main}>
        <header className={styles.header}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
            <div className={styles.breadcrumb}>
              <span>Workstream GH</span> <span>›</span> <strong>Faturamento</strong>
            </div>
            {data && <MesFilter meses={data.meses} mesSel={data.mesSel} base="/faturamento" />}
          </div>
          {err && <div className={styles.errorBanner}>Erro: {err}</div>}
        </header>

        <div className={styles.body}>
          {data && (
            <>
              <div className={styles.cards}>
                <Card label={filtrado ? `Receita (${mesLabel(data.mesSel)})` : "Receita total"} value={fmtBRL(data.receitaTotal)} />
                <Card label={filtrado ? `Vendas (${mesLabel(data.mesSel)})` : "Vendas"} value={fmt(data.vendasTotal)} />
                <Card label="Ticket médio" value={fmtBRL(data.ticketMedio)} />
                <Card label={`Mês atual (${data.mesAtual.label || "—"})`} value={fmtBRL(data.mesAtual.receita)} sub={`${fmt(data.mesAtual.vendas)} vendas`} />
              </div>

              <Section title="Receita por mês (últimos 12 — pela data de compra)">
                {data.porMes.map((m) => <MoneyBar key={m.ym} label={`${m.label} · ${fmt(m.vendas)}v`} value={m.receita} max={mesMax} />)}
              </Section>

              <Section title={filtrado ? `Por tipo de plano (${mesLabel(data.mesSel)})` : "Por tipo de plano"}>
                {data.planos.map((p) => <MoneyBar key={p.plano} label={p.plano} value={p.receita} max={planoMax} />)}
              </Section>

              <Section title={filtrado ? `Por categoria (${mesLabel(data.mesSel)})` : "Por categoria"}>
                {data.categorias.map((c) => <MoneyBar key={c.cat} label={c.cat} value={c.receita} max={catMax} />)}
              </Section>

              <p className={styles.note}>
                Soma o “Valor do Plano” pela data de compra de cada aluno na mestre. É o bruto contratado (sem descontos de forma de pagamento).
              </p>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
