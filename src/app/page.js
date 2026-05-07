"use client";

import { useState, useEffect, useMemo } from "react";
import styles from "./page.module.css";

const OUTCOMES = ["Atendeu", "Não atendeu", "Comprou", "Não interessado", "Remarcar"];

const STORAGE_KEY = "crm-students-v2";
const THEME_KEY = "crm-theme";
const INGESTED_KEY = "crm-ingested-server-ids"; // ids de alunos do webhook já trazidos pra cá

const getPastDate = (days) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split("T")[0];
};

// Extrai dias da tag string. Aceita "N dias", "N dia" e "Hoje" (= 0).
const tagDays = (tag) => {
  if (typeof tag === "string" && tag.toLowerCase().trim() === "hoje") return 0;
  const m = String(tag || "").match(/-?\d+/);
  return m ? parseInt(m[0], 10) : NaN;
};

const getDueDate = (assignmentDate, tag) => {
  const d = new Date(assignmentDate);
  d.setDate(d.getDate() + tagDays(tag));
  d.setHours(0, 0, 0, 0);
  return d;
};

const startOfToday = () => {
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return t;
};

const dayDiff = (date) => {
  const today = startOfToday();
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  return Math.round((target - today) / (1000 * 60 * 60 * 24));
};

const formatCountdown = (diff) => {
  if (diff < 0) return `Atrasado há ${Math.abs(diff)} ${Math.abs(diff) === 1 ? "dia" : "dias"}`;
  if (diff === 0) return "Vence hoje";
  if (diff === 1) return "Vence amanhã";
  return `Vence em ${diff} dias`;
};

const onlyDigits = (phone) => phone.replace(/\D/g, "");

const formatPhone = (phone) => {
  const d = onlyDigits(phone);
  if (d.length === 13) return `+${d.slice(0, 2)} ${d.slice(2, 4)} ${d.slice(4, 9)}-${d.slice(9)}`;
  if (d.length === 12) return `+${d.slice(0, 2)} ${d.slice(2, 4)} ${d.slice(4, 8)}-${d.slice(8)}`;
  return phone;
};

const getInitials = (name) =>
  name.split(" ").map((n) => n[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();

// Bucketiza as cores existentes (vermelho/amarelo/laranja/verde) por urgência.
// Funciona pra qualquer número de dias, não só os 4 canônicos.
//   1-3 dias:   vermelho (alta urgência)
//   4-7 dias:   amarelo
//   8-15 dias:  laranja
//   16+ dias:   verde (calmo)
const getTagClass = (tag) => {
  const days = tagDays(tag);
  if (!Number.isFinite(days) || days <= 3) return styles.tag3d;
  if (days <= 7) return styles.tag7d;
  if (days <= 15) return styles.tag15d;
  return styles.tag30d;
};


export default function Home() {
  const [students, setStudents] = useState([]);
  const [hydrated, setHydrated] = useState(false);
  const [history, setHistory] = useState({});
  const [theme, setTheme] = useState("light");

  const [tagFilter, setTagFilter] = useState("Todos");
  const [statusFilter, setStatusFilter] = useState("pendente");
  const [search, setSearch] = useState("");

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newStudent, setNewStudent] = useState({
    name: "", phone: "", days: "7", observations: "",
  });

  const [callModal, setCallModal] = useState(null);
  const [editModal, setEditModal] = useState(null);
  const [bucketModal, setBucketModal] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);

  const toggleSelect = (id) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const toggleSelectAllInTag = (items) => {
    const ids = items.map((it) => it.student.id);
    const allSelected = ids.every((id) => selectedIds.includes(id));
    setSelectedIds((prev) => {
      if (allSelected) return prev.filter((id) => !ids.includes(id));
      const set = new Set([...prev, ...ids]);
      return Array.from(set);
    });
  };

  const clearSelection = () => setSelectedIds([]);

  const deleteSelected = () => {
    if (!selectedIds.length) return;
    if (!confirm(`Excluir ${selectedIds.length} aluno(s)? Essa ação não pode ser desfeita.`)) return;
    setStudents((prev) => prev.filter((s) => !selectedIds.includes(s.id)));
    setHistory((prev) => {
      const next = { ...prev };
      for (const id of selectedIds) delete next[id];
      return next;
    });
    setSelectedIds([]);
  };

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        setStudents(parsed.students || []);
        setHistory(parsed.history || {});
      } else {
        // Inicia vazio — alunos chegam via webhook ManyChat ou botão Adicionar
        setStudents([]);
      }
      const savedTheme = localStorage.getItem(THEME_KEY);
      if (savedTheme === "dark") setTheme("dark");
    } catch {
      setStudents([]);
    }
    setHydrated(true);
  }, []);

  // ── Ingestão one-way de alunos vindos do webhook (ManyChat) ─────────────
  // Sincronização com server (KV via /api/students). Hidratação + poll 60s.
  //
  // Semântica:
  //   - Aluno NOVO no server (não existe local) → adiciona no topo.
  //   - Aluno JÁ EXISTE local (match por phone) → atualiza follow-ups com a
  //     versão do server (representa "vontade atual" do aluno via webhook),
  //     PRESERVANDO status/outcome/calledAt das tags já chamadas localmente.
  //   - Aluno deletado localmente: a deleção também apaga no server (ver
  //     deleteStudent), então não volta no próximo poll.
  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;

    const phoneKey = (p) => onlyDigits(p).slice(-10);

    const sync = async () => {
      try {
        const res = await fetch("/api/students", { cache: "no-store" });
        if (!res.ok) return;
        const { students: serverList } = await res.json();
        if (cancelled || !Array.isArray(serverList)) return;

        setStudents((prev) => {
          let changed = false;
          const localByPhone = new Map(prev.map((s) => [phoneKey(s.phone), s]));
          const next = [...prev];

          for (const sv of serverList) {
            const key = phoneKey(sv.phone);
            const local = localByPhone.get(key);

            if (!local) {
              // Novo aluno no server → insere
              next.unshift(sv);
              changed = true;
              continue;
            }

            // Aluno existe localmente. Faz merge de follow-ups:
            // chamadas concluídas locais vencem o server pro mesmo tag.
            const localByTag = new Map(
              (local.followUps || []).map((f) => [f.tag, f])
            );
            const mergedFollowUps = (sv.followUps || []).map((svFu) => {
              const lf = localByTag.get(svFu.tag);
              if (lf && lf.status && lf.status !== "pendente") return lf;
              return svFu;
            });

            const localStr = JSON.stringify(local.followUps || []);
            const mergedStr = JSON.stringify(mergedFollowUps);
            if (localStr !== mergedStr) {
              const idx = next.findIndex((s) => s === local);
              if (idx !== -1) {
                next[idx] = {
                  ...local,
                  observations: local.observations || sv.observations,
                  followUps: mergedFollowUps,
                };
                changed = true;
              }
            }
          }

          return changed ? next : prev;
        });
      } catch {
        // silencia — dev sem servidor / offline
      }
    };

    sync();
    const interval = setInterval(sync, 60_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ students, history }));
  }, [students, history, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(THEME_KEY, theme);
  }, [theme, hydrated]);

  const followUpItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    const items = [];
    for (const student of students) {
      if (q) {
        const phoneDigits = onlyDigits(student.phone);
        const matches = student.name.toLowerCase().includes(q) || phoneDigits.includes(onlyDigits(q));
        if (!matches) continue;
      }
      for (const fu of student.followUps) {
        if (tagFilter !== "Todos" && fu.tag !== tagFilter) continue;
        if (statusFilter !== "Todos" && fu.status !== statusFilter) continue;
        const due = getDueDate(student.assignmentDate, fu.tag);
        items.push({ student, fu, due, diff: dayDiff(due) });
      }
    }
    return items;
  }, [students, search, tagFilter, statusFilter]);

  const overdueItems = followUpItems.filter((i) => i.fu.status === "pendente" && i.diff < 0);
  const todayItems = followUpItems.filter((i) => i.fu.status === "pendente" && i.diff === 0);
  const calledTodayCount = useMemo(() => {
    const t = startOfToday().toISOString().split("T")[0];
    return students.reduce(
      (acc, s) => acc + s.followUps.filter((f) => f.calledAt === t).length, 0,
    );
  }, [students]);

  const updateFollowUp = (studentId, tag, patch) => {
    setStudents((prev) =>
      prev.map((s) =>
        s.id === studentId
          ? {
              ...s,
              followUps: s.followUps.map((f) => (f.tag === tag ? { ...f, ...patch } : f)),
            }
          : s,
      ),
    );
  };

  const markAsCalled = (studentId, tag, outcome) => {
    const today = startOfToday().toISOString().split("T")[0];
    updateFollowUp(studentId, tag, { status: "chamado", outcome, calledAt: today });
    setHistory((prev) => {
      const list = prev[studentId] || [];
      return {
        ...prev,
        [studentId]: [{ tag, outcome, date: today }, ...list],
      };
    });
    setCallModal(null);
  };

  const reopenFollowUp = (studentId, tag) => {
    updateFollowUp(studentId, tag, { status: "pendente", outcome: null, calledAt: null });
  };

  const handleAddStudent = (e) => {
    e.preventDefault();
    const days = parseInt(newStudent.days, 10);
    if (!Number.isFinite(days) || days < 0 || days > 365) return;
    const tag = days === 0 ? "Hoje" : `${days} ${days === 1 ? "dia" : "dias"}`;
    const today = startOfToday().toISOString().split("T")[0];
    setStudents((prev) => [
      {
        id: Date.now(),
        name: newStudent.name,
        phone: onlyDigits(newStudent.phone),
        assignmentDate: today,
        observations: newStudent.observations,
        followUps: [{ tag, status: "pendente", outcome: null, calledAt: null }],
      },
      ...prev,
    ]);
    setIsAddOpen(false);
    setNewStudent({ name: "", phone: "", days: "7", observations: "" });
  };

  const saveEdit = (e) => {
    e.preventDefault();
    // Edição só altera dados do contato (nome/phone/obs). Pra mudar quantos
    // dias de follow-up, apaga o aluno e cria de novo (ou re-aplica tag no
    // ManyChat com o novo Follow).
    setStudents((prev) =>
      prev.map((s) =>
        s.id === editModal.id
          ? {
              ...s,
              name: editModal.name,
              phone: onlyDigits(editModal.phone),
              observations: editModal.observations,
            }
          : s,
      ),
    );
    setEditModal(null);
  };

  const deleteStudent = (id) => {
    // Apaga local imediatamente (UI snappy)
    const target = students.find((s) => s.id === id);
    setStudents((prev) => prev.filter((s) => s.id !== id));
    setHistory((prev) => {
      const { [id]: _, ...rest } = prev;
      return rest;
    });
    // Apaga no server também (senão o sync de 60s ressuscita o aluno)
    if (target?.phone) {
      const phone = onlyDigits(target.phone);
      fetch(`/api/students?phone=${encodeURIComponent(phone)}`, { method: "DELETE" })
        .catch(() => { /* silencia — local já foi apagado, próximo F5 reconcilia */ });
    }
    setEditModal(null);
  };

  // Tags presentes nos dados (independente de filtro de busca/tag).
  // Usado pelos filter pills no topo — só mostra "5 dias" se algum lead tem.
  const presentTags = useMemo(() => {
    const set = new Set();
    for (const s of students) {
      for (const fu of s.followUps || []) {
        set.add(fu.tag);
      }
    }
    return Array.from(set).sort((a, b) => tagDays(a) - tagDays(b));
  }, [students]);

  // Reset tagFilter se a tag selecionada sumir dos dados (ex: último lead
  // daquele bucket foi apagado/chamado).
  useEffect(() => {
    if (tagFilter !== "Todos" && !presentTags.includes(tagFilter)) {
      setTagFilter("Todos");
    }
  }, [presentTags, tagFilter]);

  const groupedByTag = useMemo(() => {
    const groups = {};
    for (const item of followUpItems) {
      if (!groups[item.fu.tag]) groups[item.fu.tag] = [];
      groups[item.fu.tag].push(item);
    }
    for (const tag in groups) {
      groups[tag].sort((a, b) => a.diff - b.diff);
    }
    return groups;
  }, [followUpItems]);

  // Colunas a renderizar: tags presentes nos itens já filtrados (search +
  // tagFilter + statusFilter aplicados). Sorted ascending por dias.
  const visibleColumns = useMemo(() => {
    const tags = Object.keys(groupedByTag).filter((t) => groupedByTag[t].length > 0);
    return tags.sort((a, b) => tagDays(a) - tagDays(b));
  }, [groupedByTag]);

  if (!hydrated) {
    return <div className={styles.container} />;
  }

  return (
    <div className={`${styles.container} ${theme === "dark" ? "dark" : ""}`}>
      <aside className={styles.sidebar}>
        <div className={styles.logo}>G</div>
        <button
          className={styles.themeToggle}
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          title={theme === "dark" ? "Modo claro" : "Modo escuro"}
          aria-label="Alternar tema"
        >
          {theme === "dark" ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="5"></circle>
              <line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line>
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
              <line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line>
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
            </svg>
          )}
        </button>
      </aside>

      <main className={styles.main}>
        <header className={styles.header}>
          <div className={styles.headerTop}>
            <div className={styles.titleWrapper}>
              <h1>CRM GH</h1>
              <p>Gerenciamento de Retornos (Follow-ups)</p>
            </div>

            <div className={styles.headerActions}>
              <div className={styles.stats}>
                <div className={styles.statItem}>
                  <span className={styles.statValue}>{students.length}</span>
                  <span className={styles.statLabel}>Alunos</span>
                </div>
                <div className={styles.statItem}>
                  <span className={styles.statValue} style={{ color: "var(--overdue)" }}>{overdueItems.length}</span>
                  <span className={styles.statLabel}>Atrasados</span>
                </div>
                <div className={styles.statItem}>
                  <span className={styles.statValue} style={{ color: "var(--gold)" }}>{todayItems.length}</span>
                  <span className={styles.statLabel}>Hoje</span>
                </div>
                <div className={styles.statItem}>
                  <span className={styles.statValue} style={{ color: "var(--done-text)" }}>{calledTodayCount}</span>
                  <span className={styles.statLabel}>Chamados Hoje</span>
                </div>
              </div>

              <button className={styles.addBtn} onClick={() => setIsAddOpen(true)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
                Adicionar Aluno
              </button>
            </div>
          </div>
        </header>

        <div className={styles.toolbar}>
          <div className={styles.searchWrapper}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
            <input
              type="text"
              className={styles.searchInput}
              placeholder="Buscar por nome ou telefone..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

        </div>

        {(overdueItems.length > 0 || todayItems.length > 0) && (
          <div className={`${styles.alertsRow} ${overdueItems.length === 0 || todayItems.length === 0 ? styles.single : ""}`}>
            {overdueItems.length > 0 && (
              <button
                type="button"
                className={`${styles.panel} ${styles.panelOverdue} ${styles.panelClickable}`}
                onClick={() => setBucketModal("overdue")}
                aria-label={`Ver ${overdueItems.length} alunos atrasados`}
              >
                <div className={styles.panelHeader}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line>
                    <line x1="12" y1="16" x2="12.01" y2="16"></line>
                  </svg>
                  <span>Atrasados</span>
                  <span className={styles.panelBadge}>{overdueItems.length}</span>
                </div>
                <div className={styles.panelHint}>
                  Clique para ver e chamar os alunos atrasados
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="9 18 15 12 9 6"></polyline>
                  </svg>
                </div>
              </button>
            )}

            {todayItems.length > 0 && (
              <button
                type="button"
                className={`${styles.panel} ${styles.panelToday} ${styles.panelClickable}`}
                onClick={() => setBucketModal("today")}
                aria-label={`Ver ${todayItems.length} alunos para hoje`}
              >
                <div className={styles.panelHeader}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
                    <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
                  </svg>
                  <span>Lembretes de Hoje</span>
                  <span className={styles.panelBadge}>{todayItems.length}</span>
                </div>
                <div className={styles.panelHint}>
                  Clique para ver os alunos do dia
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="9 18 15 12 9 6"></polyline>
                  </svg>
                </div>
              </button>
            )}
          </div>
        )}

        <div className={styles.filters}>
          <div className={styles.filterGroup}>
            {["Todos", ...presentTags].map((f) => (
              <button
                key={f}
                className={`${styles.filterBtn} ${tagFilter === f ? styles.active : ""}`}
                onClick={() => setTagFilter(f)}
              >
                {f}
              </button>
            ))}
          </div>
          <div className={styles.filterDivider}></div>
          <div className={styles.filterGroup}>
            {[
              { key: "pendente", label: "Não Chamados" },
              { key: "chamado", label: "Chamados" },
              { key: "Todos", label: "Todos" },
            ].map((s) => (
              <button
                key={s.key}
                className={`${styles.filterBtn} ${statusFilter === s.key ? styles.active : ""}`}
                onClick={() => setStatusFilter(s.key)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.board}>
          {visibleColumns.map((tag) => {
            const items = groupedByTag[tag] || [];
            const allSelected = items.length > 0 && items.every((it) => selectedIds.includes(it.student.id));
            return (
              <div key={tag} className={styles.column}>
                <div className={styles.columnHeader}>
                  <span className={styles.columnTitle}>CHAMAR {tag}</span>
                  <div className={styles.columnHeaderRight}>
                    {items.length > 0 && (
                      <button
                        type="button"
                        className={`${styles.selectAllBtn} ${allSelected ? styles.selectAllActive : ""}`}
                        onClick={() => toggleSelectAllInTag(items)}
                      >
                        {allSelected ? "Limpar" : "Marcar todos"}
                      </button>
                    )}
                    <span className={styles.columnCount}>{items.length}</span>
                  </div>
                </div>

                {items.length === 0 && <div className={styles.emptyCol}>Nenhum aluno</div>}

                {items.map(({ student, fu, due, diff }) => {
                  const isOverdue = fu.status === "pendente" && diff < 0;
                  const isToday = fu.status === "pendente" && diff === 0;
                  const isDone = fu.status === "chamado";
                  const isSelected = selectedIds.includes(student.id);
                  const cardClass = [
                    styles.card,
                    getTagClass(fu.tag),
                    isOverdue && styles.cardOverdue,
                    isToday && styles.cardToday,
                    isDone && styles.cardDone,
                    isSelected && styles.cardSelected,
                  ].filter(Boolean).join(" ");

                  const countdownClass = isDone
                    ? styles.countdownDone
                    : isOverdue
                      ? styles.countdownOverdue
                      : isToday
                        ? styles.countdownToday
                        : styles.countdownFuture;

                  const studentHistory = history[student.id] || [];

                  const waLink = `https://wa.me/${onlyDigits(student.phone)}?text=${encodeURIComponent(
                    `Olá ${student.name.split(" ")[0]}, tudo bem?`,
                  )}`;

                  return (
                    <div key={`${student.id}-${fu.tag}`} className={cardClass}>
                      <div className={styles.cardHeader}>
                        <div className={styles.cardHeaderLeft}>
                          <input
                            type="checkbox"
                            className={styles.selectCheckbox}
                            checked={isSelected}
                            onChange={() => toggleSelect(student.id)}
                            aria-label={`Selecionar ${student.name}`}
                          />
                          <div className={styles.avatar}>{getInitials(student.name)}</div>
                          <div className={styles.cardHeaderText}>
                            <h3 className={styles.cardTitle} title={student.name}>{student.name}</h3>
                            <p className={styles.cardSubtitle}>{formatPhone(student.phone)}</p>
                          </div>
                        </div>
                        <span className={`${styles.cardCountdown} ${countdownClass}`}>
                          {isDone
                            ? `✓ Chamado`
                            : formatCountdown(diff)}
                        </span>
                      </div>

                      <div className={styles.cardMeta}>
                        <span className={`${styles.tag} ${getTagClass(fu.tag)}`}>{fu.tag}</span>
                      </div>

                      <div className={styles.cardDates}>
                        <span className={styles.cardDate} title="Data de inclusão">
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                            <line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line>
                            <line x1="3" y1="10" x2="21" y2="10"></line>
                          </svg>
                          Incluído: {new Date(student.assignmentDate).toLocaleDateString("pt-BR")}
                        </span>
                        <span className={styles.cardDate} title="Data de expiração do follow-up">
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline>
                          </svg>
                          Vence: {due.toLocaleDateString("pt-BR")}
                        </span>
                      </div>

                      {student.observations && (
                        <div className={styles.cardObs}>{student.observations}</div>
                      )}

                      {isDone && fu.outcome && (
                        <div className={styles.outcomeBadge}>
                          ✓ {fu.outcome}
                          <button onClick={() => reopenFollowUp(student.id, fu.tag)} title="Reabrir lembrete">↺</button>
                        </div>
                      )}

                      <div className={styles.cardActions}>
                        <div className={styles.actionRow}>
                          <a
                            href={waLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`${styles.actionBtn} ${styles.btnWhats}`}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/>
                            </svg>
                            WhatsApp
                          </a>
                          {!isDone ? (
                            <button
                              className={`${styles.actionBtn} ${styles.btnDone}`}
                              onClick={() => setCallModal({ studentId: student.id, tag: fu.tag, name: student.name })}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                                <polyline points="20 6 9 17 4 12"></polyline>
                              </svg>
                              Chamado
                            </button>
                          ) : (
                            <button
                              className={`${styles.actionBtn} ${styles.btnSecondary}`}
                              onClick={() => reopenFollowUp(student.id, fu.tag)}
                              title="Reabrir"
                            >
                              ↺ Reabrir
                            </button>
                          )}
                        </div>
                        <div className={styles.actionRow} style={{ justifyContent: "flex-end" }}>
                          <button
                            className={`${styles.actionBtn} ${styles.btnSecondary}`}
                            onClick={() =>
                              setEditModal({
                                id: student.id,
                                name: student.name,
                                phone: student.phone,
                                observations: student.observations || "",
                                tags: student.followUps.map((f) => f.tag),
                              })
                            }
                            title="Editar"
                            aria-label="Editar aluno"
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                            </svg>
                          </button>
                          <button
                            className={`${styles.actionBtn} ${styles.btnDanger}`}
                            onClick={() => {
                              if (confirm(`Excluir ${student.name}?`)) deleteStudent(student.id);
                            }}
                            title="Excluir aluno"
                            aria-label="Excluir aluno"
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <polyline points="3 6 5 6 21 6"></polyline>
                              <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"></path>
                              <path d="M10 11v6"></path><path d="M14 11v6"></path>
                              <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"></path>
                            </svg>
                          </button>
                        </div>
                      </div>

                      {studentHistory.length > 0 && (
                        <details className={styles.history}>
                          <summary>Histórico ({studentHistory.length})</summary>
                          <div className={styles.historyList}>
                            {studentHistory.slice(0, 5).map((h, idx) => (
                              <div key={idx} className={styles.historyItem}>
                                <strong>{h.tag}</strong> · {h.outcome} ·{" "}
                                {new Date(h.date).toLocaleDateString("pt-BR")}
                              </div>
                            ))}
                          </div>
                        </details>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </main>

      {selectedIds.length > 0 && (
        <div className={styles.bulkBar}>
          <span>
            {selectedIds.length} {selectedIds.length === 1 ? "aluno selecionado" : "alunos selecionados"}
          </span>
          <button
            type="button"
            className={`${styles.bulkBarBtn} ${styles.bulkBarBtnDanger}`}
            onClick={deleteSelected}
          >
            Excluir
          </button>
          <button
            type="button"
            className={`${styles.bulkBarBtn} ${styles.bulkBarBtnGhost}`}
            onClick={clearSelection}
          >
            Cancelar
          </button>
        </div>
      )}

      {isAddOpen && (
        <div className={styles.modalOverlay} onClick={() => setIsAddOpen(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>Adicionar Aluno</h2>
              <button className={styles.closeBtn} onClick={() => setIsAddOpen(false)}>×</button>
            </div>

            <form onSubmit={handleAddStudent}>
              <div className={styles.formGroup}>
                <label>Nome Completo</label>
                <input
                  type="text" className={styles.input} required placeholder="Ex: João da Silva"
                  value={newStudent.name}
                  onChange={(e) => setNewStudent({ ...newStudent, name: e.target.value })}
                />
              </div>

              <div className={styles.formGroup}>
                <label>Telefone / WhatsApp</label>
                <input
                  type="text" className={styles.input} required placeholder="+55 11 99999-9999"
                  value={newStudent.phone}
                  onChange={(e) => setNewStudent({ ...newStudent, phone: e.target.value })}
                />
              </div>

              <div className={styles.formGroup}>
                <label>Daqui a quantos dias chamar?</label>
                <input
                  type="number"
                  min="0"
                  max="365"
                  className={styles.input}
                  placeholder="Ex: 7 (use 0 pra disparar hoje)"
                  value={newStudent.days}
                  onChange={(e) => setNewStudent({ ...newStudent, days: e.target.value })}
                  required
                />
              </div>

              <div className={styles.formGroup}>
                <label>Observações (opcional)</label>
                <textarea
                  className={styles.textarea}
                  placeholder="Contexto inicial, preferência de horário, etc."
                  value={newStudent.observations}
                  onChange={(e) => setNewStudent({ ...newStudent, observations: e.target.value })}
                />
              </div>

              <button
                type="submit"
                className={styles.submitBtn}
                disabled={(() => {
                  const d = parseInt(newStudent.days, 10);
                  return !Number.isFinite(d) || d < 0 || d > 365;
                })()}
              >
                Salvar Aluno
              </button>
            </form>
          </div>
        </div>
      )}

      {callModal && (
        <div className={styles.modalOverlay} onClick={() => setCallModal(null)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>Resultado do Contato</h2>
              <button className={styles.closeBtn} onClick={() => setCallModal(null)}>×</button>
            </div>
            <p style={{ color: "var(--text-muted)", marginBottom: 16, fontSize: 14 }}>
              {callModal.name} · {callModal.tag}
            </p>
            <div className={styles.outcomeGrid}>
              {OUTCOMES.map((o) => (
                <button
                  key={o}
                  className={styles.outcomeBtn}
                  onClick={() => markAsCalled(callModal.studentId, callModal.tag, o)}
                >
                  {o}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {bucketModal && (() => {
        const isOverdue = bucketModal === "overdue";
        const list = isOverdue ? overdueItems : todayItems;
        const title = isOverdue ? "Alunos Atrasados" : "Lembretes de Hoje";
        const subtitle = isOverdue
          ? "Estes alunos já passaram do prazo de retorno."
          : "Estes alunos vencem hoje. Faça o follow-up.";
        return (
          <div className={styles.modalOverlay} onClick={() => setBucketModal(null)}>
            <div
              className={`${styles.modal} ${styles.modalWide}`}
              onClick={(e) => e.stopPropagation()}
            >
              <div className={styles.modalHeader}>
                <div>
                  <h2 className={styles.modalTitle}>
                    {title} <span className={styles.modalCount}>{list.length}</span>
                  </h2>
                  <p className={styles.modalSubtitle}>{subtitle}</p>
                </div>
                <button className={styles.closeBtn} onClick={() => setBucketModal(null)}>×</button>
              </div>

              {list.length === 0 ? (
                <div className={styles.emptyCol}>Nenhum aluno aqui. Bom trabalho!</div>
              ) : (
                <div className={styles.bucketList}>
                  {list.map(({ student, fu, diff }) => {
                    const waLink = `https://wa.me/${onlyDigits(student.phone)}?text=${encodeURIComponent(
                      `Olá ${student.name.split(" ")[0]}, tudo bem?`,
                    )}`;
                    return (
                      <div key={`bk-${student.id}-${fu.tag}`} className={styles.bucketRow}>
                        <div className={styles.bucketInfo}>
                          <div className={styles.avatar}>{getInitials(student.name)}</div>
                          <div className={styles.bucketTextCol}>
                            <div className={styles.bucketName}>{student.name}</div>
                            <div className={styles.bucketSub}>{formatPhone(student.phone)}</div>
                            <div className={styles.bucketMeta}>
                              <span className={`${styles.tag} ${getTagClass(fu.tag)}`}>{fu.tag}</span>
                              <span
                                className={`${styles.cardCountdown} ${
                                  isOverdue ? styles.countdownOverdue : styles.countdownToday
                                }`}
                              >
                                {formatCountdown(diff)}
                              </span>
                            </div>
                            <div className={styles.cardDates}>
                              <span className={styles.cardDate}>
                                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                                  <line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line>
                                  <line x1="3" y1="10" x2="21" y2="10"></line>
                                </svg>
                                Incluído: {new Date(student.assignmentDate).toLocaleDateString("pt-BR")}
                              </span>
                              <span className={styles.cardDate}>
                                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline>
                                </svg>
                                Vence: {new Date(getDueDate(student.assignmentDate, fu.tag)).toLocaleDateString("pt-BR")}
                              </span>
                            </div>
                            {student.observations && (
                              <div className={styles.bucketObs}>{student.observations}</div>
                            )}
                          </div>
                        </div>
                        <div className={styles.bucketActions}>
                          <a
                            href={waLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`${styles.actionBtn} ${styles.btnWhats}`}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
                            </svg>
                            WhatsApp
                          </a>
                          <button
                            className={`${styles.actionBtn} ${styles.btnDone}`}
                            onClick={() =>
                              setCallModal({ studentId: student.id, tag: fu.tag, name: student.name })
                            }
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                              <polyline points="20 6 9 17 4 12"></polyline>
                            </svg>
                            Chamado
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {editModal && (
        <div className={styles.modalOverlay} onClick={() => setEditModal(null)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>Editar Aluno</h2>
              <button className={styles.closeBtn} onClick={() => setEditModal(null)}>×</button>
            </div>

            <form onSubmit={saveEdit}>
              <div className={styles.formGroup}>
                <label>Nome</label>
                <input
                  type="text" className={styles.input} required
                  value={editModal.name}
                  onChange={(e) => setEditModal({ ...editModal, name: e.target.value })}
                />
              </div>

              <div className={styles.formGroup}>
                <label>Telefone</label>
                <input
                  type="text" className={styles.input} required
                  value={editModal.phone}
                  onChange={(e) => setEditModal({ ...editModal, phone: e.target.value })}
                />
              </div>

              <div className={styles.formGroup}>
                <label>Observações</label>
                <textarea
                  className={styles.textarea}
                  value={editModal.observations}
                  onChange={(e) => setEditModal({ ...editModal, observations: e.target.value })}
                />
              </div>

              <button type="submit" className={styles.submitBtn}>
                Salvar Alterações
              </button>
              <button
                type="button"
                className={styles.deleteLink}
                onClick={() => {
                  if (confirm(`Excluir ${editModal.name}?`)) deleteStudent(editModal.id);
                }}
              >
                Excluir aluno
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
