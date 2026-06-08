"use client";

import { useState, useEffect, useMemo } from "react";
import styles from "./metricas.module.css";

const STORAGE_KEY = "crm-metricas-v1";

const todayInfo = () => {
  const d = new Date();
  return {
    diasMes: new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(),
    diaAtual: d.getDate(),
    monthKey: `${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`,
  };
};

const DEFAULTS = {
  meta: 50000,
  diasMes: 31,
  diaAtual: 1,
  totalLeads: 0,
  primeiraPergunta: 0,
  ofertaFeita: 0,
  link: 0,
  vendaNoDia: 0,
  followUp: 0,
};

const fmtBRL = (n) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(n || 0);
const pct = (n) => `${(n * 100).toFixed(1).replace(".", ",")}%`;

function parseMoney(v) {
  if (!v) return 0;
  const s = String(v).replace(/[^\d,.-]/g, "").replace(",", ".");
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

export default function MetricasPage() {
  const [hydrated, setHydrated] = useState(false);
  const [inputs, setInputs] = useState(DEFAULTS);
  const [students, setStudents] = useState([]);
  const [leadsAuto, setLeadsAuto] = useState(null); // { totalLeads, boasVindas, quente, link }
  const [loadError, setLoadError] = useState(null);

  // Hydrate from localStorage + auto-detect dia/dias do mês
  useEffect(() => {
    const t = todayInfo();
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      const parsed = saved ? JSON.parse(saved) : null;
      setInputs({
        ...DEFAULTS,
        ...(parsed || {}),
        // sempre sincroniza dia/dias com hoje (pode overridar se quiser, mas default é "agora")
        diasMes: parsed?.diasMes ?? t.diasMes,
        diaAtual: parsed?.diaAtual ?? t.diaAtual,
      });
    } catch {
      setInputs({ ...DEFAULTS, diasMes: t.diasMes, diaAtual: t.diaAtual });
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(inputs)); } catch {}
  }, [inputs, hydrated]);

  // Buscar alunos
  useEffect(() => {
    fetch("/api/students", { cache: "no-store" })
      .then(async (r) => {
        const ct = r.headers.get("content-type") || "";
        if (r.status === 401 || !ct.includes("application/json")) {
          window.location.href = "/sign-in";
          return null;
        }
        return r.json();
      })
      .then((j) => {
        if (j?.ok) setStudents(j.students || []);
        else if (j?.error) setLoadError(j.error);
      })
      .catch((e) => setLoadError(String(e?.message || e)));
  }, []);

  // Buscar stats da planilha de leads (PAINEL DE LEADS)
  useEffect(() => {
    fetch("/api/leads-stats", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (j?.ok) setLeadsAuto(j); })
      .catch(() => {});
  }, []);

  // Quando leadsAuto chega, popula automaticamente os campos correspondentes
  // (só na primeira vez ou se o usuário não tocou — usamos como override do inputs).
  useEffect(() => {
    if (!leadsAuto) return;
    setInputs((s) => ({
      ...s,
      totalLeads: leadsAuto.totalLeads ?? s.totalLeads,
      primeiraPergunta: leadsAuto.boasVindas ?? s.primeiraPergunta,
      ofertaFeita: leadsAuto.quente ?? s.ofertaFeita,
      link: leadsAuto.link ?? s.link,
    }));
  }, [leadsAuto]);

  const update = (k) => (e) => {
    const v = e.target.value;
    setInputs((s) => ({ ...s, [k]: v === "" ? 0 : Number(v) || 0 }));
  };

  // Stats da planilha (mês corrente)
  const auto = useMemo(() => {
    const { monthKey } = todayInfo();
    let faturado = 0, vendas = 0;
    for (const s of students) {
      const m = (s.dataCompra || "").match(/(\d{2})\/(\d{4})/);
      if (m && `${m[1]}/${m[2]}` === monthKey) {
        faturado += parseMoney(s.totalRec || s.valorPlano);
        vendas++;
      }
    }
    return { faturado, vendas };
  }, [students]);

  const stats = useMemo(() => {
    const { meta, diasMes, diaAtual, totalLeads } = inputs;
    const paceIdeal = diasMes > 0 ? diaAtual / diasMes : 0;
    const realizado = meta > 0 ? auto.faturado / meta : 0;
    const projecao = diaAtual > 0 ? (auto.faturado / diaAtual) * diasMes : 0;
    const paceDelta = paceIdeal > 0 ? (realizado / paceIdeal - 1) : 0;
    const ticket = auto.vendas > 0 ? auto.faturado / auto.vendas : 0;
    const faltaFechar = Math.max(0, meta - auto.faturado);
    const diasRestantes = Math.max(0, diasMes - diaAtual);
    const fatPorDiaRestante = diasRestantes > 0 ? faltaFechar / diasRestantes : 0;
    const conv = totalLeads > 0 ? auto.vendas / totalLeads : 0;
    const vendasFaltam = ticket > 0 ? Math.ceil(faltaFechar / ticket) : 0;
    const leadsFaltam = conv > 0 ? Math.ceil(vendasFaltam / conv) : 0;
    return {
      paceIdeal, realizado, projecao, paceDelta, ticket,
      faltaFechar, diasRestantes, fatPorDiaRestante,
      conv, vendasFaltam, leadsFaltam,
    };
  }, [inputs, auto]);

  const funil = useMemo(() => {
    const { totalLeads, primeiraPergunta, ofertaFeita, link, vendaNoDia, followUp } = inputs;
    const f = (top) => totalLeads > 0 ? top / totalLeads : 0;
    return [
      { etapa: "Leads → 1ª pergunta",  qtd: primeiraPergunta, taxa: f(primeiraPergunta) },
      { etapa: "Leads → Oferta",       qtd: ofertaFeita,      taxa: f(ofertaFeita) },
      { etapa: "Leads → Link",         qtd: link,             taxa: f(link) },
      { etapa: "Leads → Venda no dia", qtd: vendaNoDia,       taxa: f(vendaNoDia) },
      { etapa: "Leads → Follow-up",    qtd: followUp,         taxa: f(followUp) },
      { etapa: "Leads → Total vendas", qtd: auto.vendas,      taxa: stats.conv },
    ];
  }, [inputs, auto, stats.conv]);

  if (!hydrated) return null;

  return (
    <div className={styles.container}>
      <main className={styles.main}>
        <header className={styles.header}>
          <div className={styles.breadcrumb}>
            <span>Workstream GH</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
            <strong>📊 Métricas do mês</strong>
          </div>
          {loadError && (
            <div className={styles.errorBanner}>Erro ao buscar alunos: {loadError}</div>
          )}
        </header>

        <div className={styles.layout}>
          {/* Coluna de inputs (esquerda) */}
          <aside className={styles.inputsCol}>
            <SectionTitle>Período</SectionTitle>
            <Field label="Meta do mês (R$)" value={inputs.meta} onChange={update("meta")} />
            <Field label="Dias no mês" value={inputs.diasMes} onChange={update("diasMes")} />
            <Field label="Dia atual" value={inputs.diaAtual} onChange={update("diaAtual")} />

            <SectionTitle style={{ marginTop: 20 }}>
              Funil do mês {leadsAuto && <span style={{ fontWeight: 400, textTransform: "none", color: "var(--gold)", marginLeft: 6 }}>auto</span>}
            </SectionTitle>
            <Field label="Total de leads" value={inputs.totalLeads} onChange={update("totalLeads")} auto={!!leadsAuto} />
            <Field label="1ª pergunta respondida" value={inputs.primeiraPergunta} onChange={update("primeiraPergunta")} auto={!!leadsAuto} />
            <Field label="Oferta feita (QUENTE)" value={inputs.ofertaFeita} onChange={update("ofertaFeita")} auto={!!leadsAuto} />
            <Field label="Link enviado" value={inputs.link} onChange={update("link")} auto={!!leadsAuto} />
            <Field label="Venda no dia" value={inputs.vendaNoDia} onChange={update("vendaNoDia")} />
            <Field label="Follow-up convertido" value={inputs.followUp} onChange={update("followUp")} />

            <div className={styles.helper}>
              💾 Inputs salvos no navegador. <strong>Total de leads, 1ª pergunta, Oferta feita e Link enviado</strong> vêm da planilha "PAINEL DE LEADS" (mês corrente). <strong>Faturamento, vendas e ticket</strong> vêm da CONTROLE ALUNOS.
            </div>
          </aside>

          {/* Coluna de stats (direita) */}
          <div className={styles.statsCol}>
            {/* Progresso da meta */}
            <section className={styles.progressoCard}>
              <div className={styles.progressoHeader}>
                <span className={styles.cardLabel}>PROGRESSO DA META</span>
                <span className={stats.paceDelta < 0 ? styles.deltaNeg : styles.deltaPos}>
                  {stats.paceDelta >= 0 ? "+" : ""}{(stats.paceDelta * 100).toFixed(1).replace(".", ",")}% do pace
                </span>
              </div>
              <div className={styles.kpiRow}>
                <KPI label="Pace ideal" value={pct(stats.paceIdeal)} />
                <KPI label="Realizado" value={pct(stats.realizado)} />
                <KPI label="Meta" value={fmtBRL(inputs.meta)} />
                <KPI label="Projeção fim do mês" value={fmtBRL(stats.projecao)} />
              </div>
              <div className={styles.bar}>
                <div className={styles.barFill} style={{ width: `${Math.min(100, stats.realizado * 100)}%` }} />
                <div className={styles.barIdealMark} style={{ left: `${Math.min(100, stats.paceIdeal * 100)}%` }} />
              </div>
              <div className={styles.barLegend}>
                <span><span className={styles.legendIdeal} /> Pace ideal</span>
                <span><span className={styles.legendReal} /> Realizado</span>
              </div>
            </section>

            {/* Cards principais */}
            <div className={styles.cardsGrid}>
              <BigCard
                label="Faturado"
                value={fmtBRL(auto.faturado)}
                sub={`${pct(stats.realizado)} da meta`}
              />
              <BigCard
                label="Falta fechar"
                value={stats.faltaFechar === 0 ? "Meta batida!" : fmtBRL(stats.faltaFechar)}
                sub={`${stats.diasRestantes} dias restantes`}
                accent={stats.faltaFechar === 0 ? "green" : "red"}
              />
              <BigCard
                label="Conv. leads → venda"
                value={pct(stats.conv)}
                sub="benchmark: 5%"
              />
              <BigCard
                label="Vendas realizadas"
                value={auto.vendas}
                sub={`ticket médio ${fmtBRL(stats.ticket)}`}
              />
            </div>

            <div className={styles.bottomRow}>
              {/* Funil */}
              <section className={styles.funilCard}>
                <div className={styles.cardLabel}>FUNIL DE CONVERSÃO</div>
                <div className={styles.funilTable}>
                  <div className={`${styles.funilRow} ${styles.funilHead}`}>
                    <span>ETAPA</span><span>QTD</span><span>TAXA</span>
                  </div>
                  {funil.map((r) => (
                    <div className={styles.funilRow} key={r.etapa}>
                      <span>{r.etapa}</span>
                      <span>{r.qtd}</span>
                      <span>{pct(r.taxa)}</span>
                    </div>
                  ))}
                </div>
              </section>

              {/* Pra bater a meta */}
              <section className={styles.praBaterCard}>
                <div className={styles.cardLabel}>PRA BATER A META, AINDA PRECISA DE</div>
                {stats.faltaFechar === 0 ? (
                  <div className={styles.metaBatida}>✓ Meta batida!</div>
                ) : (
                  <>
                    <div className={styles.kpiRow}>
                      <KPI label="Vendas" value={stats.vendasFaltam} />
                      <KPI label="Fat./dia" value={fmtBRL(stats.fatPorDiaRestante)} />
                      <KPI label="Leads*" value={stats.leadsFaltam || "—"} />
                    </div>
                    <div className={styles.praBaterFooter}>
                      * com conv. atual de <strong>{pct(stats.conv)}</strong> (ticket médio {fmtBRL(stats.ticket)})
                    </div>
                  </>
                )}
              </section>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function SectionTitle({ children, style }) {
  return <div className={styles.sectionTitle} style={style}>{children}</div>;
}

function Field({ label, value, onChange, auto }) {
  return (
    <div className={styles.field}>
      <label>
        {label}
        {auto && <span title="Auto da planilha — pode sobrescrever manualmente"> 🔁</span>}
      </label>
      <input type="number" value={value} onChange={onChange} step="any" min="0" />
    </div>
  );
}

function KPI({ label, value }) {
  return (
    <div className={styles.kpi}>
      <div className={styles.kpiLabel}>{label}</div>
      <div className={styles.kpiValue}>{value}</div>
    </div>
  );
}

function BigCard({ label, value, sub, accent }) {
  return (
    <div className={`${styles.bigCard} ${accent ? styles[`accent_${accent}`] : ""}`}>
      <div className={styles.cardLabel}>{label}</div>
      <div className={styles.bigValue}>{value}</div>
      <div className={styles.bigSub}>{sub}</div>
    </div>
  );
}
