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

// Mesma chave do servidor (src/lib/suporte-status.js) — estável entre fetches.
const itemKey = (it) => `${it.kind}|${it.timestamp}|${it.sheetId || it.aluno || ""}`;

export default function SuportePage() {
  const [data, setData] = useState({ ajustes: [], feedbacks: [], chats: [] });
  const [resolvidos, setResolvidos] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filtro, setFiltro] = useState("todos"); // todos | ajuste | feedback | chat | resolvidos
  const [busca, setBusca] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/suporte", { cache: "no-store" });
        const j = await r.json();
        if (!alive) return;
        if (j.ok) {
          setData({ ajustes: j.ajustes || [], feedbacks: j.feedbacks || [], chats: j.chats || [] });
          setResolvidos(j.resolvidos || {});
        } else setError(j.error || "erro");
      } catch (e) {
        if (alive) setError(String(e.message || e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  // Otimista: atualiza a UI na hora e persiste no servidor; se falhar, desfaz.
  async function toggleResolvido(it) {
    const key = itemKey(it);
    const was = !!resolvidos[key];
    setResolvidos((m) => {
      const n = { ...m };
      if (was) delete n[key];
      else n[key] = { em: new Date().toISOString() };
      return n;
    });
    try {
      const r = await fetch("/api/suporte", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, resolved: !was }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
    } catch {
      setResolvidos((m) => {
        const n = { ...m };
        if (was) n[key] = { em: new Date().toISOString() };
        else delete n[key];
        return n;
      });
    }
  }

  const items = useMemo(() => {
    let all = [...data.ajustes, ...data.feedbacks, ...data.chats];
    all.sort((a, b) => parseTs(b.timestamp) - parseTs(a.timestamp));
    if (filtro === "resolvidos") all = all.filter((i) => resolvidos[itemKey(i)]);
    else {
      all = all.filter((i) => !resolvidos[itemKey(i)]); // padrão: esconde tratados
      if (filtro !== "todos") all = all.filter((i) => i.kind === filtro);
    }
    const q = norm(busca).trim();
    if (q) all = all.filter((i) => norm(i.aluno).includes(q) || norm(i.mensagem).includes(q) || norm(i.resposta).includes(q));
    return all;
  }, [data, filtro, busca, resolvidos]);

  const pendente = (i) => !resolvidos[itemKey(i)];
  const nAj = data.ajustes.filter(pendente).length;
  const nFb = data.feedbacks.filter(pendente).length;
  const nCh = data.chats.filter(pendente).length;
  const nRes = Object.keys(resolvidos).length;

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <h1 className={styles.title}>💬 Suporte</h1>
        <p className={styles.sub}>Pedidos de ajuste e feedbacks que os alunos mandam pelo app.</p>
      </header>

      <div className={styles.filters}>
        <button className={`${styles.chip} ${filtro === "todos" ? styles.active : ""}`} onClick={() => setFiltro("todos")}>Tudo ({nAj + nFb + nCh})</button>
        <button className={`${styles.chip} ${filtro === "ajuste" ? styles.active : ""}`} onClick={() => setFiltro("ajuste")}>🔧 Ajustes ({nAj})</button>
        <button className={`${styles.chip} ${filtro === "feedback" ? styles.active : ""}`} onClick={() => setFiltro("feedback")}>💬 Feedbacks ({nFb})</button>
        <button className={`${styles.chip} ${filtro === "chat" ? styles.active : ""}`} onClick={() => setFiltro("chat")}>🤖 Chatbot ({nCh})</button>
        <button className={`${styles.chip} ${filtro === "resolvidos" ? styles.active : ""}`} onClick={() => setFiltro("resolvidos")}>✅ Resolvidos ({nRes})</button>
        <input className={styles.search} placeholder="Buscar aluno ou texto…" value={busca} onChange={(e) => setBusca(e.target.value)} />
      </div>

      {loading && <p className={styles.muted}>Carregando…</p>}
      {error && <p className={styles.err}>Erro: {error}</p>}
      {!loading && !error && items.length === 0 && <p className={styles.muted}>Nada por aqui ainda.</p>}

      <div className={styles.list}>
        {items.map((it, i) => {
          const fotoUrl = it.kind === "ajuste" && it.fotos ? (String(it.fotos).match(/https?:\/\/\S+/) || [])[0] : null;
          return (
            <div key={i} className={`${styles.card} ${it.kind === "ajuste" ? styles.cardAjuste : it.kind === "chat" ? styles.cardChat : styles.cardFeedback}`}>
              <div className={styles.cardTop}>
                <span className={`${styles.badge} ${it.kind === "ajuste" ? styles.badgeAjuste : it.kind === "chat" ? styles.badgeChat : styles.badgeFeedback}`}>
                  {it.kind === "ajuste" ? `🔧 Ajuste · ${it.contexto || "—"}` : it.kind === "chat" ? `🤖 Chatbot${it.tipo === "pro_gh" ? " · pediu ajuste" : ""}` : `💬 ${it.tipo || "Feedback"}`}
                </span>
                {it.kind === "ajuste" && (
                  <span className={`${styles.status} ${styles["st_" + (it.status || "pending")] || ""}`}>{it.status || "pending"}</span>
                )}
                <span className={styles.ts}>{fmtTs(it.timestamp)}</span>
                <button
                  onClick={() => toggleResolvido(it)}
                  title={resolvidos[itemKey(it)] ? "Voltar pra fila" : "Marcar como resolvido (só no painel, não mexe no app do aluno)"}
                  style={{ marginLeft: "auto", border: "1px solid var(--border, #d1d5db)", background: "transparent", borderRadius: 6, padding: "0.15rem 0.5rem", cursor: "pointer", fontSize: "0.78rem" }}
                >
                  {resolvidos[itemKey(it)] ? "↩ Reabrir" : "✓ Resolver"}
                </button>
              </div>
              <div className={styles.aluno}>{it.aluno || "—"}</div>
              <div className={styles.msg}>{it.mensagem || "—"}</div>
              {it.kind === "chat" && it.resposta && (
                <div className={styles.resposta}><span className={styles.respLabel}>🤖 IA:</span> {it.resposta}</div>
              )}
              {(it.sheetId || fotoUrl) && (
                <div className={styles.cardFoot}>
                  {it.sheetId && (
                    <a className={styles.link} href={`${PROTO}${it.sheetId}&tab=TREINO`} target="_blank" rel="noopener">ver protocolo</a>
                  )}
                  {(it.kind === "ajuste" || it.kind === "chat") && it.sheetId && (
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
