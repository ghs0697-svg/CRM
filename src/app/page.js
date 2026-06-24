"use client";

import { useState, useEffect, useMemo } from "react";
import styles from "./page.module.css";

const THEME_KEY = "crm-theme";

// Tabela enxuta — coluna WhatsApp + 5 campos essenciais.
const MAIN_COLUMNS = [
  { key: "nome",            label: "Nome",          sortable: true },
  { key: "_wa",             label: "WhatsApp" },
  { key: "tipoPlano",       label: "Tipo de Plano", sortable: true },
  { key: "dataVencimento",  label: "Vencimento",    sortable: true },
  { key: "statusPlano",     label: "Status",        sortable: true },
  { key: "acaoNecessaria",  label: "Ação" },
];

// Drawer — todos os 23 campos agrupados.
const DETAIL_GROUPS = [
  {
    title: "Identidade",
    fields: [
      { key: "contato", label: "WhatsApp" },
      { key: "cpf",     label: "CPF" },
    ],
  },
  {
    title: "Status do Plano",
    fields: [
      { key: "statusPlano",          label: "Status" },
      { key: "acaoNecessaria",       label: "Ação Necessária" },
      { key: "dataVencimento",       label: "Data de vencimento" },
      { key: "dataContatoRenovacao", label: "Contato p/ Renovação" },
    ],
  },
  {
    title: "Plano",
    fields: [
      { key: "tipoPlano",         label: "Tipo de Plano" },
      { key: "protocoloAtual",    label: "Protocolo atual" },
      { key: "versaoAtual",       label: "Versão atual" },
      { key: "protocoloHormonal", label: "Hormonal?" },
      { key: "peptideos",         label: "Peptídeos" },
      { key: "categoria",         label: "Categoria" },
    ],
  },
  {
    title: "Financeiro",
    fields: [
      { key: "valorPlano",      label: "Valor do Plano" },
      { key: "totalRec",        label: "Total a receber" },
      { key: "formaPagamento",  label: "Forma de Pagamento" },
      { key: "dataPagamento",   label: "Data do Pagamento" },
      { key: "proximoReajuste", label: "Próximo Reajuste" },
    ],
  },
  {
    title: "Histórico",
    fields: [
      { key: "dataCompra",        label: "Data de compra" },
      { key: "protocoloInicial",  label: "Protocolo inicial" },
      { key: "mesesExtras",       label: "Meses extras" },
    ],
  },
  {
    title: "Outros",
    fields: [
      { key: "tags",     label: "Tags" },
      { key: "linkSite", label: "Link do site" },
    ],
  },
];

const DATE_KEYS = new Set(["dataVencimento", "dataContatoRenovacao", "dataCompra", "dataPagamento"]);
const MONEY_KEYS = new Set(["valorPlano", "totalRec"]);

// Campos que podem ser editados pela UI. Inputs e selects controlados aqui.
const EDIT_FIELD_CONFIG = {
  dataCompra:        { type: "text",   placeholder: "DD/MM/YYYY" },
  tipoPlano:         { type: "select", options: ["", "Mensal", "Trimestral", "Semestral", "Anual"] },
  protocoloHormonal: { type: "select", options: ["Não", "Sim"] },
  valorPlano:        { type: "text",   placeholder: "697" },
  proximoReajuste:   { type: "text",   placeholder: "DD/MM/YYYY" },
  dataPagamento:     { type: "text",   placeholder: "DD/MM/YYYY" },
  formaPagamento:    { type: "select", options: ["", "Pix", "Greenn", "Cartão", "Parcelado", "Recorrente parc."] },
  cpf:               { type: "text",   placeholder: "000.000.000-00" },
  tags:              { type: "text",   placeholder: "pago 697, GREENN, ANUAL" },
  peptideos:         { type: "select", options: ["Não", "Sim"] },
  mesesExtras:       { type: "text",   placeholder: "0/1/2" },
  categoria:         { type: "select", options: ["Padrão", "Black"] },
  linkSite:          { type: "text",   placeholder: "https://..." },
};

const AVATAR_COLORS = [
  "#3B82F6", "#EF4444", "#10B981", "#F59E0B", "#8B5CF6",
  "#EC4899", "#14B8A6", "#F97316", "#6366F1", "#84CC16",
];

function parsePtBrDate(str) {
  if (!str || typeof str !== "string") return null;
  const m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return new Date(+m[3], +m[2] - 1, +m[1]);
}

function extractDigits(s) {
  return String(s ?? "").replace(/\D/g, "");
}

function formatPhone(digits) {
  const d = extractDigits(digits);
  if (d.length < 10) return digits || "—";
  return `+${d.slice(0, 2)} ${d.slice(2, 4)} ${d.slice(4, d.length - 4)}-${d.slice(-4)}`;
}

function getInitials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function colorFromName(name) {
  const s = String(name || "");
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function Avatar({ name, categoria, large }) {
  const isBlack = categoria === "Black";
  const cls = [
    styles.avatar,
    large ? styles.avatarLg : "",
    isBlack ? styles.avatarBlack : "",
  ].filter(Boolean).join(" ");
  return (
    <span
      className={cls}
      style={isBlack ? undefined : { backgroundColor: colorFromName(name) }}
    >
      {getInitials(name)}
    </span>
  );
}

function StatusBadge({ value }) {
  if (!value) return <span className={styles.muted}>—</span>;
  const cls = value === "Ativo" ? styles.ativo : value === "Vencido" ? styles.vencido : styles.pendente;
  return <span className={`${styles.statusBadge} ${cls}`}>{value}</span>;
}

function renderFieldValue(key, value) {
  if (value === null || value === undefined || value === "") {
    return <span className={styles.muted}>—</span>;
  }
  if (key === "contato") {
    const digits = extractDigits(value);
    return digits
      ? <a className={styles.drawerWa} href={`https://wa.me/${digits}`} target="_blank" rel="noreferrer">{formatPhone(digits)}</a>
      : value;
  }
  if (key === "linkSite" && value !== "-") {
    try { new URL(value); return <a href={value} target="_blank" rel="noreferrer" style={{ color: "#0284C7" }}>{value}</a>; }
    catch { return value; }
  }
  if (MONEY_KEYS.has(key)) return `R$ ${value}`;
  if (key === "statusPlano") return <StatusBadge value={value} />;
  return value;
}

function StatCard({ color, icon, value, label, onClick, active }) {
  const clickable = typeof onClick === "function";
  return (
    <div
      className={styles.statCard}
      onClick={onClick}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } : undefined}
      title={clickable ? (active ? "Filtro ativo — clique pra limpar" : "Clique pra filtrar a lista") : undefined}
      style={clickable ? { cursor: "pointer", outline: active ? "2px solid var(--gold)" : "none", outlineOffset: 2 } : undefined}
    >
      <div className={`${styles.statIcon} ${styles[color]}`}>{icon}</div>
      <div className={styles.statInfo}>
        <span className={styles.statValue}>{value}</span>
        <span className={styles.statLabel}>{label}</span>
      </div>
    </div>
  );
}

// Aluno na "janela de renovação": plano ATIVO, a data de contato de renovação
// (vencimento − 1 mês, quando o raio-x dispara) já chegou, e ainda não venceu.
// = os ~30 dias antes do vencimento. É a lista que o funcionário fica em cima.
function emJanelaRenovacao(s, hoje) {
  if (s.statusPlano !== "Ativo") return false;
  const venc = parsePtBrDate(s.dataVencimento);
  const contato = parsePtBrDate(s.dataContatoRenovacao);
  if (!venc || !contato) return false;
  return contato <= hoje && venc >= hoje;
}

function NotesDrawer({ insight, notaSuporte, nome, open, onClose }) {
  if (!insight && !notaSuporte) return null;
  const sections = (insight
    ? [
        {
          title: "Sobre o aluno",
          fields: [
            { key: "dor_principal", label: "Dor principal" },
            { key: "mudancas_corpo", label: "Quer mudar no corpo" },
          ],
        },
        {
          title: "Insatisfações",
          fields: [
            { key: "insatisfacao_suporte", label: "Com o suporte / atendimento" },
            { key: "insatisfacao_produto", label: "Com o produto (treino / dieta / app)" },
            { key: "prioridade_protocolo", label: "Pra Reajustes (resultado / prioridade)" },
          ],
        },
        {
          title: "Outros",
          fields: [
            // Compat: aceita o campo antigo "insatisfacoes" ate re-rodar pipeline
            { key: "insatisfacoes", label: "Insatisfações (formato antigo)" },
            { key: "notas_extras", label: "Notas extras" },
          ],
        },
      ]
    : []
  )
    .map((s) => ({ ...s, fields: s.fields.filter((f) => insight[f.key]) }))
    .filter((s) => s.fields.length > 0);

  return (
    <aside className={`${styles.notesDrawer} ${open ? styles.open : ""}`} aria-hidden={!open}>
      <div className={styles.notesDrawerHeader}>
        <span style={{ fontSize: "1.4rem" }}>📓</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className={styles.notesDrawerTitle}>Notas de Suporte</div>
          <div className={styles.notesDrawerSubtitle}>{nome}</div>
        </div>
        <button className={styles.drawerClose} onClick={onClose} title="Fechar">✕</button>
      </div>
      <div className={styles.notesDrawerBody}>
        {notaSuporte ? (
          <>
            <div className={styles.notaSuporteText}>{notaSuporte.nota}</div>
            {notaSuporte.atualizado && (
              <div className={styles.notaSuporteFoot}>Atualizado: {notaSuporte.atualizado}</div>
            )}
          </>
        ) : sections.length === 0 ? (
          <div style={{ padding: 20, color: "var(--text-muted)" }}>Sem notas registradas.</div>
        ) : (
          sections.map((sec) => (
            <div key={sec.title} className={styles.notesDrawerGroup}>
              <div className={styles.notesDrawerGroupTitle}>{sec.title}</div>
              {sec.fields.map((f) => (
                <div key={f.key} className={styles.notesDrawerCard}>
                  <div className={styles.notesDrawerCardLabel}>{f.label}</div>
                  <div className={styles.notesDrawerCardValue}>{insight[f.key]}</div>
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </aside>
  );
}

function StudentFormModal({ baseRow, onClose, onSuccess }) {
  const today = useMemo(() => {
    const d = new Date();
    return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`;
  }, []);
  const isRenovacao = !!baseRow;
  const [form, setForm] = useState({
    nome: baseRow?.nome || "",
    contato: extractDigits(baseRow?.contato) || "",
    dataCompra: today,
    tipoPlano: baseRow?.tipoPlano || "Semestral",
    valorPlano: "",
    protocoloHormonal: baseRow?.protocoloHormonal || "Não",
    peptideos: baseRow?.peptideos || "Não",
    categoria: baseRow?.categoria || "Padrão",
    formaPagamento: baseRow?.formaPagamento || "",
    cpf: baseRow?.cpf || "",
    tags: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const update = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/alunos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
      if (json.duplicate) {
        setError(
          `⚠️ Já existe aluno com esse ${json.matchedBy || "telefone"} na planilha` +
          (json.existingNome ? ` ("${json.existingNome}", linha ${json.row})` : ` (linha ${json.row})`) +
          `. Não criei linha nova. Se for renovação, usa "Nova renovação".`
        );
        return;
      }
      onSuccess(json);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <span className={styles.modalTitle}>
            {isRenovacao ? "📋 Nova renovação" : "✨ Novo aluno"}
          </span>
          <button className={styles.drawerClose} onClick={onClose}>✕</button>
        </div>
        <form onSubmit={submit}>
          <div className={styles.modalBody}>
            {error && <div className={styles.formError}>{error}</div>}
            <div className={styles.formField}>
              <label>Nome *</label>
              <input value={form.nome} onChange={(e) => update("nome", e.target.value)} required />
            </div>
            <div className={styles.formRow}>
              <div className={styles.formField}>
                <label>WhatsApp *</label>
                <input value={form.contato} onChange={(e) => update("contato", e.target.value)} placeholder="5511999998888" required />
              </div>
              <div className={styles.formField}>
                <label>Data de compra</label>
                <input value={form.dataCompra} onChange={(e) => update("dataCompra", e.target.value)} placeholder="DD/MM/YYYY" />
              </div>
            </div>
            <div className={styles.formRow}>
              <div className={styles.formField}>
                <label>Tipo de Plano</label>
                <select value={form.tipoPlano} onChange={(e) => update("tipoPlano", e.target.value)}>
                  <option value="">—</option>
                  <option value="Mensal">Mensal</option>
                  <option value="Trimestral">Trimestral</option>
                  <option value="Semestral">Semestral</option>
                  <option value="Anual">Anual</option>
                </select>
              </div>
              <div className={styles.formField}>
                <label>Valor (R$)</label>
                <input value={form.valorPlano} onChange={(e) => update("valorPlano", e.target.value)} placeholder="697" />
              </div>
            </div>
            <div className={styles.formRow}>
              <div className={styles.formField}>
                <label>Hormonal?</label>
                <select value={form.protocoloHormonal} onChange={(e) => update("protocoloHormonal", e.target.value)}>
                  <option value="Não">Não</option>
                  <option value="Sim">Sim</option>
                </select>
              </div>
              <div className={styles.formField}>
                <label>Forma de Pagamento</label>
                <select value={form.formaPagamento} onChange={(e) => update("formaPagamento", e.target.value)}>
                  <option value="">—</option>
                  <option value="Pix">Pix</option>
                  <option value="Greenn">Greenn</option>
                  <option value="Parcelado">Parcelado</option>
                </select>
              </div>
            </div>
            <div className={styles.formRow}>
              <div className={styles.formField}>
                <label>Peptídeos?</label>
                <select value={form.peptideos} onChange={(e) => update("peptideos", e.target.value)}>
                  <option value="Não">Não</option>
                  <option value="Sim">Sim</option>
                </select>
              </div>
              <div className={styles.formField}>
                <label>Categoria</label>
                <select value={form.categoria} onChange={(e) => update("categoria", e.target.value)}>
                  <option value="Padrão">Padrão</option>
                  <option value="Black">Black</option>
                </select>
              </div>
            </div>
            <div className={styles.formRow}>
              <div className={styles.formField}>
                <label>CPF (opcional)</label>
                <input value={form.cpf} onChange={(e) => update("cpf", e.target.value)} placeholder="000.000.000-00" />
              </div>
              <div className={styles.formField}>
                <label>Tags (opcional)</label>
                <input value={form.tags} onChange={(e) => update("tags", e.target.value)} placeholder="pago 697, GREENN, ANUAL" />
              </div>
            </div>
            <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginTop: "8px" }}>
              💡 Vencimento, status e ação são calculados automaticamente pela planilha.
            </p>
          </div>
          <div className={styles.modalFooter}>
            <button type="button" className={styles.btnSecondary} onClick={onClose}>Cancelar</button>
            <button type="submit" className={styles.btnPrimary} disabled={submitting}>
              {submitting ? "Salvando…" : "Adicionar à planilha"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Renovação de aluno existente. Diferente do "Novo aluno": NÃO grava direto na
// mestre — chama os endpoints da planilha MESTRE (server-side, via /api/renovacao):
// pré-preenche pela fonte de verdade (alunoConsolidado) e registra a linha nova
// pelo registrarRenovacao (idempotente, link na linha ativa, versão atual mantida).
function RenovacaoModal({ aluno, onClose, onSuccess }) {
  const cpf = aluno?.cpf || "";
  const phone = extractDigits(aluno?.contato) || "";

  const [loading, setLoading] = useState(true);
  const [cons, setCons] = useState(null);
  const [loadErr, setLoadErr] = useState(null);
  const [form, setForm] = useState({
    tipoPlano: aluno?.tipoPlano || "Semestral",
    valorPlano: "",
    formaPagamento: aluno?.formaPagamento || "Pix",
    protocoloHormonal: aluno?.protocoloHormonal || "Não",
    peptideos: aluno?.peptideos || "Não",
    categoria: aluno?.categoria || "Padrão",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  const update = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // Pré-preenche pela fonte de verdade (alunoConsolidado agrupa linhas duplicadas).
  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      setLoadErr(null);
      if (!cpf && !phone) {
        setLoadErr("Aluno sem CPF nem telefone no cadastro — não dá pra identificar na mestre.");
        setLoading(false);
        return;
      }
      try {
        const qs = new URLSearchParams(cpf ? { cpf } : { phone }).toString();
        const res = await fetch(`/api/renovacao?${qs}`, { cache: "no-store" });
        const json = await res.json();
        if (cancel) return;
        if (json.ok && json.found) {
          setCons(json);
          setForm((f) => ({
            ...f,
            tipoPlano: json.plano || f.tipoPlano,
            // pré-preenche o valor do ciclo anterior (igual à pág. do Apps Script) — editável
            valorPlano: json.valor != null && String(json.valor).trim() !== "" ? String(json.valor) : f.valorPlano,
            protocoloHormonal: json.hormonal || f.protocoloHormonal,
            peptideos: json.peptideos || f.peptideos,
            categoria: json.categoria || f.categoria,
          }));
        } else if (json.ok && !json.found) {
          setLoadErr("Aluno não encontrado na mestre por CPF/telefone. Confira o cadastro antes de renovar.");
        } else {
          setLoadErr(json.error || "Falha ao buscar o aluno na mestre.");
        }
      } catch (e) {
        if (!cancel) setLoadErr(e.message || String(e));
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, [cpf, phone]);

  async function submit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/renovacao", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          cpf,
          phone,
          plano: form.tipoPlano,
          valor: form.valorPlano,
          forma: form.formaPagamento,
          hormonal: form.protocoloHormonal,
          peptideos: form.peptideos,
          categoria: form.categoria,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setDone(json);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setSubmitting(false);
    }
  }

  const nRenov = Array.isArray(cons?.historico)
    ? cons.historico.filter((h) => /renov/i.test(h.tipo || "")).length
    : 0;

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <span className={styles.modalTitle}>📋 Renovação — {aluno?.nome || "—"}</span>
          <button className={styles.drawerClose} onClick={onClose}>✕</button>
        </div>

        {done ? (
          <>
            <div className={styles.modalBody}>
              <div style={{ padding: "12px 14px", background: "var(--done-bg, #ecfdf5)", color: "var(--done-text, #047857)", borderRadius: 8, fontSize: "0.9rem" }}>
                {done.duplicate
                  ? "✓ Já havia uma renovação registrada hoje (não duplicou)."
                  : "✓ Renovação registrada na mestre."}
                <div style={{ marginTop: 8, fontSize: "0.82rem", color: "var(--text-muted)" }}>
                  {done.linha ? `Linha ${done.linha}. ` : ""}
                  {done.versao ? `Versão atual mantida: ${done.versao}. ` : ""}
                  {done.proximaVersao ? `Entregas entrega a v${done.proximaVersao}. ` : ""}
                  {done.linkOk === false ? "⚠ Conferir link na linha ativa." : ""}
                </div>
                <div style={{ marginTop: 8, fontSize: "0.78rem", color: "var(--text-muted)" }}>
                  A versão sobe quando o aluno responder a anamnese de renovação (Entregas monta o protocolo novo).
                </div>
              </div>
            </div>
            <div className={styles.modalFooter}>
              <button className={styles.btnPrimary} onClick={() => onSuccess?.(done)}>Fechar e atualizar</button>
            </div>
          </>
        ) : (
          <form onSubmit={submit}>
            <div className={styles.modalBody}>
              {loading && <div style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginBottom: 8 }}>Carregando dados do aluno…</div>}
              {loadErr && <div className={styles.formError}>{loadErr}</div>}
              {error && <div className={styles.formError}>{error}</div>}

              {cons && (
                <div style={{ padding: "10px 12px", background: "var(--surface-2, #f3f4f6)", borderRadius: 8, fontSize: "0.82rem", color: "var(--text-muted)", marginBottom: 12 }}>
                  Ciclo atual: <strong style={{ color: "var(--text-main)" }}>{cons.plano || "—"}</strong>
                  {" · "}versão <strong style={{ color: "var(--text-main)" }}>{cons.versaoAtual || "—"}</strong>
                  {cons.proximaVersao ? ` (próxima v${cons.proximaVersao})` : ""}
                  {" · "}vence {cons.vencimento || "—"}
                  {" · "}{cons.status || "—"}
                  {nRenov > 0 ? ` · ${nRenov + 1}ª renovação` : ""}
                </div>
              )}

              <div className={styles.formRow}>
                <div className={styles.formField}>
                  <label>Novo plano</label>
                  <select value={form.tipoPlano} onChange={(e) => update("tipoPlano", e.target.value)}>
                    <option value="Trimestral">Trimestral</option>
                    <option value="Semestral">Semestral</option>
                    <option value="Anual">Anual</option>
                    <option value="Mensal">Mensal</option>
                  </select>
                </div>
                <div className={styles.formField}>
                  <label>Valor (R$) *</label>
                  <input value={form.valorPlano} onChange={(e) => update("valorPlano", e.target.value)} placeholder="697" required />
                </div>
              </div>
              <div className={styles.formRow}>
                <div className={styles.formField}>
                  <label>Forma de Pagamento</label>
                  <select value={form.formaPagamento} onChange={(e) => update("formaPagamento", e.target.value)}>
                    <option value="Pix">Pix</option>
                    <option value="Greenn">Greenn</option>
                    <option value="Parcelado">Parcelado</option>
                  </select>
                </div>
                <div className={styles.formField}>
                  <label>Categoria</label>
                  <select value={form.categoria} onChange={(e) => update("categoria", e.target.value)}>
                    <option value="Padrão">Padrão</option>
                    <option value="Black">Black</option>
                  </select>
                </div>
              </div>
              <div className={styles.formRow}>
                <div className={styles.formField}>
                  <label>Hormonal?</label>
                  <select value={form.protocoloHormonal} onChange={(e) => update("protocoloHormonal", e.target.value)}>
                    <option value="Não">Não</option>
                    <option value="Sim">Sim</option>
                  </select>
                </div>
                <div className={styles.formField}>
                  <label>Peptídeos?</label>
                  <select value={form.peptideos} onChange={(e) => update("peptideos", e.target.value)}>
                    <option value="Não">Não</option>
                    <option value="Sim">Sim</option>
                  </select>
                </div>
              </div>
              <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginTop: 8 }}>
                💡 A planilha mestre cria a linha nova nascendo certa: link na linha ativa, versão atual mantida e sem duplicar. Vencimento e status são automáticos.
              </p>
            </div>
            <div className={styles.modalFooter}>
              <button type="button" className={styles.btnSecondary} onClick={onClose}>Cancelar</button>
              <button type="submit" className={styles.btnPrimary} disabled={submitting || loading || !!loadErr}>
                {submitting ? "Registrando…" : "Registrar renovação"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function EditableField({ field, value, onChange }) {
  const cfg = EDIT_FIELD_CONFIG[field];
  if (!cfg) return null;
  if (cfg.type === "select") {
    return (
      <select
        className={styles.editInput}
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
      >
        {cfg.options.map((opt) => (
          <option key={opt} value={opt}>{opt || "—"}</option>
        ))}
      </select>
    );
  }
  return (
    <input
      type="text"
      className={styles.editInput}
      value={value || ""}
      placeholder={cfg.placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function Drawer({ row, onClose, onRenovacaoSuccess, onEditSuccess }) {
  const [notesOpen, setNotesOpen] = useState(false);
  const [renovacaoOpen, setRenovacaoOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [pausing, setPausing] = useState(false);

  // Pausar/retomar o plano = congelamento (viagem/acidente). Escreve só colunas-input
  // ("Pausado em" / "Dias extras") na mestre; o app bloqueia via status "Pausado" e ao
  // retomar os dias parados entram no vencimento. Contrato #201/#203 da Sala.
  async function handlePauseToggle(resume) {
    if (!row?._rowIndex) return;
    const ok = window.confirm(
      resume
        ? `Retomar o plano de "${row.nome}"?\n\nO acesso volta e os dias que ficou parado são somados ao vencimento — ele não perde o tempo pausado.`
        : `Pausar o plano de "${row.nome}"?\n\nO app bloqueia o acesso enquanto pausado (viagem/acidente). Quando você Retomar, os dias parados são creditados no vencimento. Não perde nada e dá pra reverter.`
    );
    if (!ok) return;
    setPausing(true);
    setEditError(null);
    try {
      const res = await fetch(`/api/alunos/${row._rowIndex}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: resume ? "resume" : "pause", nome: row.nome || "" }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
      onClose();
      onEditSuccess?.();
    } catch (err) {
      setEditError(err.message || String(err));
    } finally {
      setPausing(false);
    }
  }

  // Cancelar/reativar o plano = escreve só a coluna "Cancelado em" na mestre
  // (o app bloqueia via status). Não apaga nada; reversível. Substitui o
  // delete/des-compartilha na mão (contrato #151 da Sala).
  async function handleCancelToggle(uncancel) {
    if (!row?._rowIndex) return;
    const ok = window.confirm(
      uncancel
        ? `Reativar o plano de "${row.nome}"?\n\nLimpa a data de cancelamento na mestre — o acesso volta conforme o vencimento.`
        : `Cancelar o plano de "${row.nome}"?\n\nO app bloqueia o acesso na hora e ele sai das renovações automáticas. O protocolo NÃO é apagado (fica guardado) e dá pra reverter depois.`
    );
    if (!ok) return;
    setCanceling(true);
    setEditError(null);
    try {
      const res = await fetch(`/api/alunos/${row._rowIndex}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: uncancel ? "uncancel" : "cancel", nome: row.nome || "" }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
      onClose();
      onEditSuccess?.();
    } catch (err) {
      setEditError(err.message || String(err));
    } finally {
      setCanceling(false);
    }
  }

  async function handleDelete() {
    if (!row?._rowIndex) return;
    const ok = window.confirm(
      `Excluir "${row.nome}" da planilha mestre?\n\nIsso remove a linha permanentemente. Não dá pra desfazer.`
    );
    if (!ok) return;
    setDeleting(true);
    setEditError(null);
    try {
      const res = await fetch(
        `/api/alunos/${row._rowIndex}?nome=${encodeURIComponent(row.nome || "")}`,
        { method: "DELETE" }
      );
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
      onClose();          // fecha o drawer (a linha sumiu)
      onEditSuccess?.();  // recarrega a lista
    } catch (err) {
      setEditError(err.message || String(err));
    } finally {
      setDeleting(false);
    }
  }

  useEffect(() => {
    if (!row) return;
    const onKey = (e) => {
      if (e.key === "Escape") {
        if (notesOpen) setNotesOpen(false);
        else onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [row, onClose, notesOpen]);

  // Fecha o sub-drawer e modo edição quando troca de aluno
  useEffect(() => {
    setNotesOpen(false);
    setEditMode(false);
    setEditForm({});
    setEditError(null);
  }, [row]);

  function startEdit() {
    const seed = {};
    for (const k of Object.keys(EDIT_FIELD_CONFIG)) {
      seed[k] = row?.[k] ?? "";
    }
    setEditForm(seed);
    setEditMode(true);
    setEditError(null);
  }

  function cancelEdit() {
    setEditMode(false);
    setEditForm({});
    setEditError(null);
  }

  async function saveEdit() {
    setSavingEdit(true);
    setEditError(null);
    try {
      // diff: só campos que mudaram
      const diff = {};
      for (const k of Object.keys(EDIT_FIELD_CONFIG)) {
        const newVal = (editForm[k] ?? "").toString();
        const oldVal = (row?.[k] ?? "").toString();
        if (newVal !== oldVal) diff[k] = newVal;
      }
      if (Object.keys(diff).length === 0) {
        setEditMode(false);
        return;
      }
      const res = await fetch(`/api/alunos/${row._rowIndex}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(diff),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setEditMode(false);
      setEditForm({});
      onEditSuccess?.();
    } catch (err) {
      setEditError(err.message || String(err));
    } finally {
      setSavingEdit(false);
    }
  }

  const open = !!row;
  return (
    <>
      <div className={`${styles.overlay} ${open ? styles.open : ""}`} onClick={onClose} />
      <NotesDrawer
        insight={row?.insight}
        notaSuporte={row?.notaSuporte}
        nome={row?.nome}
        open={open && notesOpen}
        onClose={() => setNotesOpen(false)}
      />
      <aside className={`${styles.drawer} ${open ? styles.open : ""}`} aria-hidden={!open}>
        {row && (
          <>
            <div className={styles.drawerHeader}>
              <Avatar name={row.nome} categoria={row.categoria} large />
              <div className={styles.drawerHeaderInfo}>
                <div className={styles.drawerName}>{row.nome || "—"}</div>
                {extractDigits(row.contato) && (
                  <a className={styles.drawerWa} href={`https://wa.me/${extractDigits(row.contato)}`} target="_blank" rel="noreferrer">
                    {formatPhone(row.contato)}
                  </a>
                )}
                {row.ultimoTreino && (
                  <div style={{ fontSize: "0.75rem", marginTop: 2, color: row.diasSemTreino >= 7 ? "var(--overdue)" : "var(--text-muted)" }}>
                    🏋️ Último treino: {row.ultimoTreino.split("-").reverse().join("/")}
                    {row.diasSemTreino >= 1 ? ` · há ${row.diasSemTreino} dia${row.diasSemTreino > 1 ? "s" : ""}` : " · hoje"}
                    {row.diasSemTreino >= 7 ? " 😴" : ""}
                  </div>
                )}
              </div>
              {!editMode && row._rowIndex && (
                <button
                  className={styles.editBtn}
                  onClick={startEdit}
                  title="Editar dados do aluno"
                >
                  ✏️
                </button>
              )}
              {!editMode && row._rowIndex && (
                <button
                  className={styles.deleteBtn}
                  onClick={handleDelete}
                  disabled={deleting}
                  title="Excluir aluno da mestre"
                >
                  {deleting ? "…" : "🗑️"}
                </button>
              )}
              <button className={styles.drawerClose} onClick={onClose} title="Fechar (ESC)">✕</button>
            </div>

            {editError && (
              <div style={{ margin: "8px 24px", padding: "10px 14px", background: "var(--overdue-bg)", color: "var(--overdue)", borderRadius: 6, fontSize: "0.85rem" }}>
                {editError}
              </div>
            )}

            {(row.insight || row.notaSuporte) && (
              <button
                className={`${styles.notesToggle} ${notesOpen ? styles.active : ""}`}
                onClick={() => setNotesOpen((v) => !v)}
              >
                <span className={styles.notesToggleIcon}>📓</span>
                <span>Notas de Suporte</span>
                <span className={styles.notesToggleArrow}>{notesOpen ? "›" : "‹"}</span>
              </button>
            )}

            <button
              className={styles.renovacaoBtn}
              onClick={() => setRenovacaoOpen(true)}
            >
              <span>＋</span>
              <span>Nova renovação deste aluno</span>
            </button>

            {renovacaoOpen && (
              <RenovacaoModal
                aluno={row}
                onClose={() => setRenovacaoOpen(false)}
                onSuccess={(result) => {
                  setRenovacaoOpen(false);
                  onRenovacaoSuccess?.(result);
                }}
              />
            )}

            {row._rowIndex && (() => {
              const cancelado = String(row.statusPlano || "").trim().toLowerCase() === "cancelado";
              return (
                <button
                  onClick={() => handleCancelToggle(cancelado)}
                  disabled={canceling}
                  title={cancelado
                    ? "Reativa o plano (limpa a data de cancelamento na mestre)"
                    : "Marca Cancelado na mestre — bloqueia o app na hora, reversível, não apaga nada"}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                    width: "calc(100% - 48px)", margin: "0 24px 8px",
                    padding: "10px 14px", borderRadius: 8,
                    fontSize: "0.85rem", fontWeight: 600,
                    cursor: canceling ? "default" : "pointer", opacity: canceling ? 0.6 : 1,
                    background: "transparent",
                    color: cancelado ? "var(--text-muted)" : "var(--overdue)",
                    border: `1px solid ${cancelado ? "var(--text-muted)" : "var(--overdue)"}`,
                  }}
                >
                  {canceling ? "…" : cancelado ? "↩️ Reativar plano" : "🚫 Cancelar plano do aluno"}
                </button>
              );
            })()}

            {row._rowIndex && (() => {
              const st = String(row.statusPlano || "").trim().toLowerCase();
              if (st === "cancelado") return null; // cancelado é terminal, não oferece pausar
              const pausado = st === "pausado";
              return (
                <button
                  onClick={() => handlePauseToggle(pausado)}
                  disabled={pausing}
                  title={pausado
                    ? "Retoma o plano e credita os dias parados no vencimento"
                    : "Pausa o plano (viagem/acidente): bloqueia o app; ao retomar credita os dias parados. Reversível."}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                    width: "calc(100% - 48px)", margin: "0 24px 8px",
                    padding: "10px 14px", borderRadius: 8,
                    fontSize: "0.85rem", fontWeight: 600,
                    cursor: pausing ? "default" : "pointer", opacity: pausing ? 0.6 : 1,
                    background: "transparent", color: "var(--gold)", border: "1px solid var(--gold)",
                  }}
                >
                  {pausing ? "…" : pausado ? "▶ Retomar plano" : "⏸ Pausar plano"}
                </button>
              );
            })()}

            <div className={styles.drawerBody}>
              {DETAIL_GROUPS.map((group) => (
                <section key={group.title} className={styles.drawerSection}>
                  <div className={styles.drawerSectionTitle}>{group.title}</div>
                  {group.fields.map((f) => {
                    const editable = editMode && EDIT_FIELD_CONFIG[f.key];
                    return (
                      <div key={f.key} className={styles.drawerField}>
                        <span className={styles.drawerFieldLabel}>{f.label}</span>
                        {editable ? (
                          <EditableField
                            field={f.key}
                            value={editForm[f.key]}
                            onChange={(v) => setEditForm((s) => ({ ...s, [f.key]: v }))}
                          />
                        ) : (
                          <span className={styles.drawerFieldValue}>{renderFieldValue(f.key, row[f.key])}</span>
                        )}
                      </div>
                    );
                  })}
                </section>
              ))}
            </div>

            {editMode && (
              <div className={styles.drawerEditFooter}>
                <button className={styles.btnSecondary} onClick={cancelEdit} disabled={savingEdit}>Cancelar</button>
                <button className={styles.btnPrimary} onClick={saveEdit} disabled={savingEdit}>
                  {savingEdit ? "Salvando…" : "Salvar mudanças"}
                </button>
              </div>
            )}
          </>
        )}
      </aside>
    </>
  );
}

export default function Home() {
  const [theme, setTheme] = useState("light");
  const [hydrated, setHydrated] = useState(false);

  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [lastSync, setLastSync] = useState(null);

  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState("asc");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterTipo, setFilterTipo] = useState("all");
  const [filterInsight, setFilterInsight] = useState(null); // null | "suporte" | "produto" | "reajuste"
  const [search, setSearch] = useState("");
  const [vencDe, setVencDe] = useState("");   // filtro por VENCIMENTO (YYYY-MM-DD) — pra puxar porções de follow/renovação
  const [vencAte, setVencAte] = useState("");
  const [janelaRenov, setJanelaRenov] = useState(false); // só quem entrou na janela de renovação (≤30d pro vencimento, ativos)
  const [novoAlunoOpen, setNovoAlunoOpen] = useState(false);
  const [renovarRow, setRenovarRow] = useState(null); // renovação direto da linha (coluna Ação)

  useEffect(() => {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === "dark") setTheme("dark");
    } catch {}
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try { localStorage.setItem(THEME_KEY, theme); } catch {}
  }, [theme, hydrated]);

  async function load({ silent = false } = {}) {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/alunos", { cache: "no-store" });
      // Se sessão expirou ou redeploy em progresso, server pode redirecionar
      // pra /sign-in (HTML). Detecta antes de tentar JSON.parse pra não crashar.
      const ct = res.headers.get("content-type") || "";
      if (res.status === 401 || (res.redirected && res.url.includes("/sign-in"))) {
        window.location.href = "/sign-in";
        return;
      }
      if (!ct.includes("application/json")) {
        // Provavelmente HTML (redeploy em curso). Não atualiza, tenta de novo no próximo tick.
        if (!silent) throw new Error("Servidor reiniciando, tente em alguns segundos");
        return;
      }
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setStudents(Array.isArray(json.students) ? json.students : []);
      setLastSync(new Date());
    } catch (e) {
      setError(e.message || String(e));
      if (!silent) setStudents([]);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  // Auto-refresh a cada 30s. Pausa enquanto o drawer estiver aberto pra
  // não atrapalhar leitura. Recomeça quando fecha.
  useEffect(() => {
    if (selected) return;
    const id = setInterval(() => load({ silent: true }), 30_000);
    return () => clearInterval(id);
  }, [selected]);

  // Quando students muda (reload pós-edit/renovação), re-aponta o drawer
  // pra versão fresh do mesmo aluno (match por _rowIndex). Evita F5.
  useEffect(() => {
    setSelected((curr) => {
      if (!curr || !curr._rowIndex) return curr;
      const fresh = students.find((s) => s._rowIndex === curr._rowIndex);
      return fresh && fresh !== curr ? fresh : curr;
    });
  }, [students]);

  const stats = useMemo(() => {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    let total = 0, ativos = 0, vencidos = 0, renovacao = 0;
    for (const s of students) {
      total++;
      if (s.statusPlano === "Ativo") ativos++;
      if (s.statusPlano === "Vencido") vencidos++;
      if (emJanelaRenovacao(s, hoje)) renovacao++; // janela real: ≤30d pro vencimento
    }
    return { total, ativos, vencidos, renovacao };
  }, [students]);

  const tipoOptions = useMemo(() => {
    const set = new Set();
    for (const s of students) if (s.tipoPlano) set.add(s.tipoPlano);
    return Array.from(set).sort();
  }, [students]);

  const insightCounts = useMemo(() => {
    let suporte = 0, produto = 0, reajuste = 0, sumidos = 0;
    for (const s of students) {
      // Sumido = já treinou pelo app alguma vez E está 7+ dias parado E o plano segue ativo
      if (s.ultimoTreino && s.diasSemTreino >= 7 && s.statusPlano === "Ativo") sumidos++;
      const i = s.insight;
      if (!i) continue;
      if (i.insatisfacao_suporte) suporte++;
      if (i.insatisfacao_produto) produto++;
      if (i.prioridade_protocolo) reajuste++;
    }
    return { suporte, produto, reajuste, sumidos };
  }, [students]);

  const visible = useMemo(() => {
    let arr = students;
    if (filterStatus !== "all") arr = arr.filter((s) => s.statusPlano === filterStatus);
    if (filterTipo !== "all")   arr = arr.filter((s) => s.tipoPlano === filterTipo);
    if (janelaRenov) {
      const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
      arr = arr.filter((s) => emJanelaRenovacao(s, hoje));
    }
    if (filterInsight) {
      arr = arr.filter((s) => {
        if (filterInsight === "sumido")
          return !!(s.ultimoTreino && s.diasSemTreino >= 7 && s.statusPlano === "Ativo");
        const i = s.insight;
        if (!i) return false;
        if (filterInsight === "suporte")  return !!i.insatisfacao_suporte;
        if (filterInsight === "produto")  return !!i.insatisfacao_produto;
        if (filterInsight === "reajuste") return !!i.prioridade_protocolo;
        return true;
      });
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const qDigits = extractDigits(q);
      arr = arr.filter((s) =>
        (s.nome || "").toLowerCase().includes(q) ||
        (qDigits && extractDigits(s.contato).includes(qDigits))
      );
    }
    if (vencDe || vencAte) {
      const min = vencDe ? new Date(vencDe + "T00:00:00") : null;
      const max = vencAte ? new Date(vencAte + "T23:59:59") : null;
      arr = arr.filter((s) => {
        const d = parsePtBrDate(s.dataVencimento);
        if (!d) return false;             // sem vencimento válido = fora do filtro de data
        if (min && d < min) return false;
        if (max && d > max) return false;
        return true;
      });
    }
    if (sortKey) {
      const dir = sortDir === "asc" ? 1 : -1;
      const isDate = DATE_KEYS.has(sortKey);
      arr = [...arr].sort((a, b) => {
        const av = a[sortKey];
        const bv = b[sortKey];
        const aEmpty = av == null || av === "";
        const bEmpty = bv == null || bv === "";
        if (aEmpty && bEmpty) return 0;
        if (aEmpty) return 1;
        if (bEmpty) return -1;
        if (isDate) {
          const ad = parsePtBrDate(av)?.getTime() ?? Infinity;
          const bd = parsePtBrDate(bv)?.getTime() ?? Infinity;
          return (ad - bd) * dir;
        }
        const an = Number(String(av).replace(",", "."));
        const bn = Number(String(bv).replace(",", "."));
        if (!Number.isNaN(an) && !Number.isNaN(bn)) return (an - bn) * dir;
        return String(av).localeCompare(String(bv), "pt-BR") * dir;
      });
    }
    return arr;
  }, [students, filterStatus, filterTipo, filterInsight, janelaRenov, search, vencDe, vencAte, sortKey, sortDir]);

  const handleSort = (col) => {
    if (!col.sortable) return;
    if (sortKey === col.key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(col.key); setSortDir("asc"); }
  };

  const rowKey = (row, i) => row._rowIndex ?? `idx-${i}`;

  if (!hydrated) return null;

  return (
    <div className={styles.container}>
      <main className={styles.main}>
        <header className={styles.header}>
          <div className={styles.breadcrumb}>
            <span>Workstream GH</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
            <strong>Alunos</strong>
          </div>

          <div className={styles.statsCards}>
            <StatCard color="blue"   icon="👥" value={stats.total}     label="Total" />
            <StatCard color="green"  icon="✓"  value={stats.ativos}    label="Ativos" />
            <StatCard color="yellow" icon="⏳" value={stats.renovacao} label="Renovação ≤ 30d" onClick={() => setJanelaRenov((v) => !v)} active={janelaRenov} />
            <StatCard color="red"    icon="⚠️" value={stats.vencidos}  label="Vencidos" />
          </div>

          <div className={styles.actionBar}>
            <input
              className={styles.searchInput}
              placeholder="Buscar por nome ou WhatsApp…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select className={styles.filterSelect} value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
              <option value="all">Status: Todos</option>
              <option value="Ativo">Ativos</option>
              <option value="Vencido">Vencidos</option>
            </select>
            <select className={styles.filterSelect} value={filterTipo} onChange={(e) => setFilterTipo(e.target.value)}>
              <option value="all">Plano: Todos</option>
              {tipoOptions.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <div
              style={{ display: "flex", alignItems: "center", gap: 6 }}
              title="Filtra por DATA DE VENCIMENTO do plano — escolhe um intervalo (dia, semana, mês) pra puxar a porção de alunos a chamar no follow/renovação"
            >
              <span style={{ fontSize: "0.8rem", color: "var(--text-muted)", whiteSpace: "nowrap" }}>Vence:</span>
              <input
                type="date"
                aria-label="Vencimento de"
                value={vencDe}
                onChange={(e) => setVencDe(e.target.value)}
                style={{ padding: "6px 8px", borderRadius: 8, background: "transparent", color: "var(--text-main)", border: "1px solid var(--border)", fontSize: "0.8rem", colorScheme: theme === "dark" ? "dark" : "light" }}
              />
              <span style={{ color: "var(--text-muted)" }}>→</span>
              <input
                type="date"
                aria-label="Vencimento até"
                value={vencAte}
                onChange={(e) => setVencAte(e.target.value)}
                style={{ padding: "6px 8px", borderRadius: 8, background: "transparent", color: "var(--text-main)", border: "1px solid var(--border)", fontSize: "0.8rem", colorScheme: theme === "dark" ? "dark" : "light" }}
              />
              {(vencDe || vencAte) && (
                <button
                  className={styles.actionBtn}
                  style={{ fontSize: "0.72rem", padding: "4px 8px" }}
                  onClick={() => { setVencDe(""); setVencAte(""); }}
                  title="Limpar filtro de vencimento"
                >
                  ✕
                </button>
              )}
            </div>
            <button
              className={styles.actionBtn}
              onClick={() => setNovoAlunoOpen(true)}
              style={{ background: "var(--gold)", color: "white", fontWeight: 600 }}
            >
              ＋ Novo aluno
            </button>
            <button className={`${styles.actionBtn} ${styles.refreshBtn}`} onClick={load} disabled={loading}>
              {loading ? "Atualizando…" : "↻ Atualizar"}
            </button>
          </div>

          {(insightCounts.suporte + insightCounts.produto + insightCounts.reajuste + insightCounts.sumidos > 0) && (
            <div className={styles.insightFilters}>
              <span className={styles.insightFiltersLabel}>📓 Notas:</span>
              <button
                className={`${styles.insightChip} ${filterInsight === "suporte" ? styles.active : ""}`}
                onClick={() => setFilterInsight(filterInsight === "suporte" ? null : "suporte")}
                title="Alunos que reclamaram do suporte / atendimento"
              >
                Reclama do suporte
                <span className={styles.insightChipCount}>{insightCounts.suporte}</span>
              </button>
              <button
                className={`${styles.insightChip} ${filterInsight === "produto" ? styles.active : ""}`}
                onClick={() => setFilterInsight(filterInsight === "produto" ? null : "produto")}
                title="Alunos que reclamaram do produto (treino, dieta, app)"
              >
                Reclama do produto
                <span className={styles.insightChipCount}>{insightCounts.produto}</span>
              </button>
              <button
                className={`${styles.insightChip} ${filterInsight === "reajuste" ? styles.active : ""}`}
                onClick={() => setFilterInsight(filterInsight === "reajuste" ? null : "reajuste")}
                title="Alunos com sinais para o agente de Reajustes"
              >
                Pra Reajustes
                <span className={styles.insightChipCount}>{insightCounts.reajuste}</span>
              </button>
              <button
                className={`${styles.insightChip} ${filterInsight === "sumido" ? styles.active : ""}`}
                onClick={() => setFilterInsight(filterInsight === "sumido" ? null : "sumido")}
                title="Alunos ativos que já treinaram pelo app mas estão 7+ dias sem concluir treino — risco de churn, vale puxar no WhatsApp"
              >
                😴 Sumido 7+ dias
                <span className={styles.insightChipCount}>{insightCounts.sumidos}</span>
              </button>
              {filterInsight && (
                <button
                  className={styles.actionBtn}
                  style={{ marginLeft: "auto", fontSize: "0.75rem" }}
                  onClick={() => setFilterInsight(null)}
                >
                  Limpar
                </button>
              )}
            </div>
          )}

          {error && (
            <div className={styles.errorBanner}>
              <strong>Erro:</strong> {error}
            </div>
          )}
        </header>

        <div className={styles.countLine}>
          <span>
            {loading && students.length === 0
              ? "Carregando…"
              : `${visible.length} de ${students.length} alunos`}
            {sortKey && (
              <button
                className={styles.clearSortChip}
                style={{ marginLeft: 12 }}
                onClick={() => { setSortKey(null); setSortDir("asc"); }}
                title="Voltar para ordem original da planilha"
              >
                ↻ Ordem da planilha
              </button>
            )}
          </span>
          <span className={styles.lastSync}>
            {lastSync
              ? `Sincronizado às ${lastSync.toLocaleTimeString("pt-BR")} · auto-refresh 30s`
              : "—"}
          </span>
        </div>

        <div className={styles.tableWrapper}>
          {loading && students.length === 0 ? (
            <div className={styles.loadingState}>Carregando alunos…</div>
          ) : visible.length === 0 ? (
            <div className={styles.emptyState}>
              {students.length === 0 ? "Nenhum aluno na planilha." : "Nenhum aluno bate com os filtros."}
            </div>
          ) : (
            <table className={styles.dataTable}>
              <thead>
                <tr>
                  {MAIN_COLUMNS.map((col) => {
                    const isActive = sortKey === col.key;
                    const cls = [
                      col.sortable ? styles.sortable : "",
                      isActive ? styles.sortActive : "",
                    ].filter(Boolean).join(" ");
                    return (
                      <th key={col.key} className={cls} onClick={() => handleSort(col)}>
                        <div className={styles.thContent}>
                          {col.label}
                          {col.sortable && (
                            <svg className={styles.sortIcon} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                              {isActive && sortDir === "asc" ? (
                                <polyline points="7 14 12 9 17 14"></polyline>
                              ) : isActive && sortDir === "desc" ? (
                                <polyline points="7 10 12 15 17 10"></polyline>
                              ) : (
                                <>
                                  <polyline points="7 15 12 20 17 15"></polyline>
                                  <polyline points="7 9 12 4 17 9"></polyline>
                                </>
                              )}
                            </svg>
                          )}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {visible.map((row, i) => {
                  const digits = extractDigits(row.contato);
                  return (
                    <tr
                      key={rowKey(row, i)}
                      className={selected === row ? styles.selected : ""}
                      onClick={() => setSelected(row)}
                    >
                      <td>
                        <div className={styles.nameCell}>
                          <Avatar name={row.nome} categoria={row.categoria} />
                          <span className={styles.nameText}>{row.nome || "—"}</span>
                        </div>
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        {digits ? (
                          <a
                            className={styles.waBtn}
                            href={`https://wa.me/${digits}`}
                            target="_blank"
                            rel="noreferrer"
                            title={`Abrir conversa: ${formatPhone(digits)}`}
                          >
                            <svg viewBox="0 0 24 24" fill="currentColor">
                              <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413z"/>
                            </svg>
                          </a>
                        ) : <span className={styles.muted}>—</span>}
                      </td>
                      <td>{row.tipoPlano || <span className={styles.muted}>—</span>}</td>
                      <td>{row.dataVencimento || <span className={styles.muted}>—</span>}</td>
                      <td><StatusBadge value={row.statusPlano} /></td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "space-between" }}>
                          {row.acaoNecessaria
                            ? <span className={row.acaoNecessaria === "OK" ? styles.actionOk : styles.actionRequired}>{row.acaoNecessaria}</span>
                            : <span className={styles.muted}>—</span>}
                          {row._rowIndex && (
                            <button
                              type="button"
                              onClick={() => setRenovarRow(row)}
                              title="Registrar renovação deste aluno"
                              style={{ background: "transparent", border: "1px solid var(--gold)", color: "var(--gold)", borderRadius: 6, padding: "3px 9px", fontSize: "0.72rem", fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}
                            >
                              🔄 Renovar
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </main>

      <Drawer
        row={selected}
        onClose={() => setSelected(null)}
        onRenovacaoSuccess={() => {
          setSelected(null);
          load();
        }}
        onEditSuccess={() => {
          load(); // recarrega; mantém drawer aberto
        }}
      />

      {novoAlunoOpen && (
        <StudentFormModal
          baseRow={null}
          onClose={() => setNovoAlunoOpen(false)}
          onSuccess={() => {
            setNovoAlunoOpen(false);
            load();
          }}
        />
      )}

      {renovarRow && (
        <RenovacaoModal
          aluno={renovarRow}
          onClose={() => setRenovarRow(null)}
          onSuccess={() => { setRenovarRow(null); load(); }}
        />
      )}
    </div>
  );
}
