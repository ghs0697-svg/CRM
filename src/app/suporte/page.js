"use client";

import { useState, useEffect, useMemo } from "react";
import styles from "./suporte.module.css";

// O timestamp pode vir como "DD/MM/YYYY HH:MM:SS" (FEEDBACKS) OU como número de
// série do Sheets (AJUSTES_PEDIDOS, cuja coluna não é formatada como data).
// Estas helpers cobrem os dois casos pra ordenar e exibir bonito.
function _serial(raw) {
  const s = String(raw || "").trim();
  if (!/^\d+([.,]\d+)?$/.test(s)) return null;
  const v = parseFloat(s.replace(",", "."));
  return v > 30000 ? v : null; // > ~ano 1982 = serial de data
}
function _dmy(raw) {
  return String(raw || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
}
function parseTs(raw) {
  const sv = _serial(raw);
  if (sv != null) return Math.round((sv - 25569) * 86400000);
  const m = _dmy(raw);
  if (m) return Date.UTC(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  return 0;
}
function fmtTs(raw) {
  const sv = _serial(raw);
  if (sv != null) {
    const d = new Date(Math.round((sv - 25569) * 86400000));
    const p = (n) => String(n).padStart(2, "0");
    return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
  }
  return String(raw || ""); // já é DD/MM/YYYY legível
}
const norm = (s) =>
  String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

const PROTO = "https://app.metodogh.com.br/?sheet=";

export default function SuportePage() {
  const [data, setData] = useState({ ajustes: [], feedbacks: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filtro, setFiltro] = useState("todos"); // todos | ajuste | feedback
  const [busca, setBusca] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/suporte", { cache: "no-store" });
        const j = await r.json();
        if (!alive) return;
        if (j.ok) setData({ ajustes: j.ajustes || [], feedbacks: j.feedbacks || [] });
        else setError(j.error || "erro");
      } catch (e) {
        if (alive) setError(String(e.message || e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const items = useMemo(() => {
    let all = [...data.ajustes, ...data.feedbacks];
    all.sort((a, b) => parseTs(b.timestamp) - parseTs(a.timestamp));
    if (filtro !== "todos") all = all.filter((i) => i.kind === filtro);
    const q = norm(busca).trim();
    if (q) all = all.filter((i) => norm(i.aluno).includes(q) || norm(i.mensagem).includes(q));
    return all;
  }, [data, filtro, busca]);

  const nAj = data.ajustes.length;
  const nFb = data.feedbacks.length;

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <h1 className={styles.title}>💬 Suporte</h1>
        <p className={styles.sub}>Pedidos de ajuste e feedbacks que os alunos mandam pelo app.</p>
      </header>

      <div className={styles.filters}>
        <button className={`${styles.chip} ${filtro === "todos" ? styles.active : ""}`} onClick={() => setFiltro("todos")}>Tudo ({nAj + nFb})</button>
        <button className={`${styles.chip} ${filtro === "ajuste" ? styles.active : ""}`} onClick={() => setFiltro("ajuste")}>🔧 Ajustes ({nAj})</button>
        <button className={`${styles.chip} ${filtro === "feedback" ? styles.active : ""}`} onClick={() => setFiltro("feedback")}>💬 Feedbacks ({nFb})</button>
        <input className={styles.search} placeholder="Buscar aluno ou texto…" value={busca} onChange={(e) => setBusca(e.target.value)} />
      </div>

      {loading && <p className={styles.muted}>Carregando…</p>}
      {error && <p className={styles.err}>Erro: {error}</p>}
      {!loading && !error && items.length === 0 && <p className={styles.muted}>Nada por aqui ainda.</p>}

      <div className={styles.list}>
        {items.map((it, i) => {
          const fotoUrl = it.kind === "ajuste" && it.fotos ? (String(it.fotos).match(/https?:\/\/\S+/) || [])[0] : null;
          return (
            <div key={i} className={`${styles.card} ${it.kind === "ajuste" ? styles.cardAjuste : styles.cardFeedback}`}>
              <div className={styles.cardTop}>
                <span className={`${styles.badge} ${it.kind === "ajuste" ? styles.badgeAjuste : styles.badgeFeedback}`}>
                  {it.kind === "ajuste" ? `🔧 Ajuste · ${it.contexto || "—"}` : `💬 ${it.tipo || "Feedback"}`}
                </span>
                {it.kind === "ajuste" && (
                  <span className={`${styles.status} ${styles["st_" + (it.status || "pending")] || ""}`}>{it.status || "pending"}</span>
                )}
                <span className={styles.ts}>{fmtTs(it.timestamp)}</span>
              </div>
              <div className={styles.aluno}>{it.aluno || "—"}</div>
              <div className={styles.msg}>{it.mensagem || "—"}</div>
              {(it.sheetId || fotoUrl) && (
                <div className={styles.cardFoot}>
                  {it.sheetId && (
                    <a className={styles.link} href={`${PROTO}${it.sheetId}&tab=TREINO`} target="_blank" rel="noopener">ver protocolo</a>
                  )}
                  {it.kind === "ajuste" && it.sheetId && (
                    <a className={styles.link} href={`${PROTO}${it.sheetId}&tab=TREINO&edit=1`} target="_blank" rel="noopener">abrir no editor</a>
                  )}
                  {fotoUrl && (
                    <a className={styles.link} href={fotoUrl} target="_blank" rel="noopener">📎 fotos</a>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
