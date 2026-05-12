"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import styles from "./booking.module.css";

/**
 * Página standalone do agendamento.
 *
 * Fluxo (state machine):
 *   1. identify  → captura nome + telefone (lê de query string se vier do PWA)
 *   2. professionals → lista profissionais
 *   3. plans     → seleciona plano (1x/2x/4x/8x ou crédito)
 *   4. slots     → escolhe horário disponível
 *   5. confirm   → caixa de mensagem + revisar + ir pra pagamento
 *   6. redirect  → redireciona pro Greenn (ou confirma se foi via crédito)
 *
 * Acessível em: /booking?phone=5555...&name=Rubens (opcional)
 */

const STEPS = {
  IDENTIFY: "identify",
  PROFESSIONALS: "professionals",
  PLANS: "plans",
  SLOTS: "slots",
  CONFIRM: "confirm",
  DONE: "done",
};

function onlyDigits(s) {
  return String(s || "").replace(/\D/g, "");
}
function formatPhone(s) {
  const d = onlyDigits(s);
  if (d.length === 13) return `+${d.slice(0, 2)} ${d.slice(2, 4)} ${d.slice(4, 9)}-${d.slice(9)}`;
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  return s;
}
function fmtBRL(n) {
  return `R$ ${Number(n).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}
function fmtDateDay(iso) {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "short" }).toUpperCase();
}
function fmtDateShort(iso) {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

export default function BookingPage() {
  // ── STATE ──────────────────────────────────────────────
  const [step, setStep] = useState(STEPS.IDENTIFY);
  const [studentName, setStudentName] = useState("");
  const [studentPhone, setStudentPhone] = useState("");
  const [studentSubscriberId, setStudentSubscriberId] = useState(null);

  const [professionals, setProfessionals] = useState([]);
  const [loadingPros, setLoadingPros] = useState(false);
  const [errorPros, setErrorPros] = useState(null);

  const [selectedProf, setSelectedProf] = useState(null);
  const [selectedPlan, setSelectedPlan] = useState(null);

  const [slots, setSlots] = useState([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState(null);

  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [reservationResult, setReservationResult] = useState(null);

  // ── INIT (query string do PWA) ─────────────────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const qPhone = params.get("phone");
    const qName = params.get("name");
    const qSub = params.get("subscriber_id");

    if (qPhone && qName) {
      setStudentName(qName);
      setStudentPhone(qPhone);
      if (qSub) setStudentSubscriberId(qSub);
      setStep(STEPS.PROFESSIONALS);
    }
  }, []);

  // ── FETCH PROFESSIONALS ────────────────────────────────
  useEffect(() => {
    if (step !== STEPS.PROFESSIONALS) return;
    setLoadingPros(true);
    setErrorPros(null);
    const qs = studentPhone ? `?phone=${encodeURIComponent(studentPhone)}` : "";
    fetch(`/api/booking/professionals${qs}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) setProfessionals(data.professionals);
        else setErrorPros(data.error || "Erro ao listar profissionais");
      })
      .catch((err) => setErrorPros(String(err)))
      .finally(() => setLoadingPros(false));
  }, [step, studentPhone]);

  // ── FETCH SLOTS quando entra em SLOTS ──────────────────
  useEffect(() => {
    if (step !== STEPS.SLOTS || !selectedProf) return;
    setLoadingSlots(true);
    // janela de 14 dias
    const today = new Date().toISOString().split("T")[0];
    const future = new Date(Date.now() + 14 * 86400000).toISOString().split("T")[0];
    fetch(`/api/booking/slots?professional=${selectedProf.id}&from=${today}&to=${future}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) setSlots(data.slots);
        else setSlots([]);
      })
      .catch(() => setSlots([]))
      .finally(() => setLoadingSlots(false));
  }, [step, selectedProf]);

  // ── SUBMIT RESERVA ─────────────────────────────────────
  const handleConfirm = useCallback(async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const body = {
        professionalId: selectedProf.id,
        slotDate: selectedSlot.date,
        slotId: selectedSlot.id,
        planId: selectedPlan.id,
        studentName,
        studentPhone,
        studentSubscriberId,
        message,
      };
      const res = await fetch("/api/booking/reserve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.ok) {
        setSubmitError(data.error || "Falha ao criar reserva");
        setSubmitting(false);
        return;
      }
      setReservationResult(data);
      // Se foi pago com crédito → vai direto pra tela de sucesso
      if (data.isCreditPayment) {
        setStep(STEPS.DONE);
        setSubmitting(false);
        return;
      }
      // Senão → redireciona pra Greenn (após delay pra UX)
      setStep(STEPS.DONE);
      setTimeout(() => {
        window.location.href = data.paymentLink;
      }, 1500);
    } catch (err) {
      setSubmitError(String(err));
      setSubmitting(false);
    }
  }, [selectedProf, selectedSlot, selectedPlan, studentName, studentPhone, studentSubscriberId, message]);

  // ── AGRUPAMENTO de slots por dia (pra timeline) ────────
  const slotsByDay = useMemo(() => {
    const groups = {};
    for (const s of slots) {
      if (!groups[s.date]) groups[s.date] = [];
      groups[s.date].push(s);
    }
    return groups;
  }, [slots]);

  const sortedDays = useMemo(() => Object.keys(slotsByDay).sort(), [slotsByDay]);

  // ── HANDLERS ───────────────────────────────────────────
  const goBack = () => {
    if (step === STEPS.PROFESSIONALS) setStep(STEPS.IDENTIFY);
    else if (step === STEPS.PLANS) { setStep(STEPS.PROFESSIONALS); setSelectedProf(null); }
    else if (step === STEPS.SLOTS) { setStep(STEPS.PLANS); setSelectedSlot(null); }
    else if (step === STEPS.CONFIRM) setStep(STEPS.SLOTS);
  };

  // ── RENDER ─────────────────────────────────────────────
  return (
    <div className={styles.container}>
      <div className={styles.appShell}>
      <header className={styles.header}>
        {step !== STEPS.IDENTIFY && step !== STEPS.DONE && (
          <button className={styles.backBtn} onClick={goBack} aria-label="Voltar">←</button>
        )}
        <h1 className={styles.headerTitle}>
          {step === STEPS.IDENTIFY && "AGENDAMENTO"}
          {step === STEPS.PROFESSIONALS && "PROFISSIONAIS"}
          {step === STEPS.PLANS && "PLANOS"}
          {step === STEPS.SLOTS && "HORÁRIOS"}
          {step === STEPS.CONFIRM && "CONFIRMAR"}
          {step === STEPS.DONE && "PRONTO!"}
        </h1>
        <div style={{ width: 32 }} />
      </header>

      <main className={styles.main}>
        {step === STEPS.IDENTIFY && (
          <StepIdentify
            name={studentName}
            phone={studentPhone}
            onSubmit={(n, p) => {
              setStudentName(n);
              setStudentPhone(p);
              setStep(STEPS.PROFESSIONALS);
            }}
          />
        )}

        {step === STEPS.PROFESSIONALS && (
          <StepProfessionals
            loading={loadingPros}
            error={errorPros}
            professionals={professionals}
            onSelect={(p) => {
              setSelectedProf(p);
              setStep(STEPS.PLANS);
            }}
          />
        )}

        {step === STEPS.PLANS && selectedProf && (
          <StepPlans
            professional={selectedProf}
            onSelect={(plan) => {
              setSelectedPlan(plan);
              setStep(STEPS.SLOTS);
            }}
            onUseCredit={() => {
              setSelectedPlan({ id: "credit", sessions: 1, value: 0, label: "Usando crédito" });
              setStep(STEPS.SLOTS);
            }}
          />
        )}

        {step === STEPS.SLOTS && (
          <StepSlots
            loading={loadingSlots}
            professional={selectedProf}
            plan={selectedPlan}
            slotsByDay={slotsByDay}
            sortedDays={sortedDays}
            onSelect={(slot) => {
              setSelectedSlot(slot);
              setStep(STEPS.CONFIRM);
            }}
          />
        )}

        {step === STEPS.CONFIRM && (
          <StepConfirm
            professional={selectedProf}
            plan={selectedPlan}
            slot={selectedSlot}
            message={message}
            setMessage={setMessage}
            submitting={submitting}
            error={submitError}
            onConfirm={handleConfirm}
          />
        )}

        {step === STEPS.DONE && (
          <StepDone
            isCreditPayment={reservationResult?.isCreditPayment}
            paymentLink={reservationResult?.paymentLink}
          />
        )}
      </main>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
//  STEP COMPONENTS
// ────────────────────────────────────────────────────────────
function StepIdentify({ name: initialName, phone: initialPhone, onSubmit }) {
  const [name, setName] = useState(initialName || "");
  const [phone, setPhone] = useState(initialPhone || "");
  const valid = name.trim().length >= 3 && onlyDigits(phone).length >= 10;
  return (
    <div className={styles.identify}>
      <div className={styles.identifyHero}>
        <div className={styles.identifyEmoji}>📅</div>
        <h2 className={styles.identifyTitle}>Agendar com Profissional</h2>
        <p className={styles.identifySub}>
          Aulas individuais com a equipe oficial do Método GH. Pagamento antecipado, vaga confirmada na hora.
        </p>
      </div>

      <div className={styles.formGroup}>
        <label className={styles.label}>Seu nome</label>
        <input
          className={styles.input}
          type="text"
          placeholder="João da Silva"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className={styles.formGroup}>
        <label className={styles.label}>Seu WhatsApp (com DDD)</label>
        <input
          className={styles.input}
          type="tel"
          inputMode="numeric"
          placeholder="55 11 99999-9999"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
      </div>
      <button
        className={styles.primaryBtn}
        disabled={!valid}
        onClick={() => onSubmit(name.trim(), onlyDigits(phone))}
      >
        Continuar →
      </button>
    </div>
  );
}

function StepProfessionals({ loading, error, professionals, onSelect }) {
  if (loading) return <div className={styles.loading}>Carregando…</div>;
  if (error) return <div className={styles.error}>{error}</div>;
  return (
    <div>
      <p className={styles.intro}>
        Atendimento <b>online ao vivo</b> com a equipe oficial. Escolhe o profissional:
      </p>
      {professionals.map((p) => (
        <button
          key={p.id}
          className={styles.profCard}
          onClick={() => onSelect(p)}
        >
          <div className={styles.profHead}>
            <div className={`${styles.profAvatar} ${styles[`avatar_${p.id}`]}`}>
              <img src={p.photo} alt={p.name} onError={(e) => { e.target.style.display = "none"; }} />
            </div>
            <div className={styles.profInfo}>
              <div className={styles.profName}>{p.name}</div>
              <div className={styles.profSpec}>{p.spec}</div>
            </div>
          </div>
          <div className={styles.profBio}>{p.bio}</div>
          <div className={styles.profMeta}>
            <div className={styles.profMetaLeft}>
              <span className={styles.profDuration}>{p.durationMin} min · Google Meet</span>
              <span className={styles.profPrice}>
                A partir de {fmtBRL(p.plans[p.plans.length - 1].perSession)}/sessão
              </span>
            </div>
            {p.credits && p.credits.remaining > 0 && (
              <span className={styles.profCredits}>
                ⚡ {p.credits.remaining} créditos
              </span>
            )}
          </div>
        </button>
      ))}
    </div>
  );
}

function StepPlans({ professional, onSelect, onUseCredit }) {
  const hasCredits = professional.credits && professional.credits.remaining > 0;
  return (
    <div>
      <div className={styles.profHead} style={{ marginBottom: 16 }}>
        <div className={`${styles.profAvatar} ${styles[`avatar_${professional.id}`]}`}>
          <img src={professional.photo} alt={professional.name} onError={(e) => { e.target.style.display = "none"; }} />
        </div>
        <div className={styles.profInfo}>
          <div className={styles.profName}>{professional.name}</div>
          <div className={styles.profSpec}>{professional.spec}</div>
        </div>
      </div>

      <p className={styles.intro}>Escolhe o plano:</p>

      {hasCredits && (
        <button className={styles.planCardCredit} onClick={onUseCredit}>
          <div className={styles.planRadioOuter}><div className={styles.planRadioInner} /></div>
          <div className={styles.planInfo}>
            <div className={styles.planTitle}>Usar crédito</div>
            <div className={styles.planSub}>{professional.credits.remaining} disponíveis · grátis</div>
          </div>
          <div className={styles.planPriceGreen}>R$ 0</div>
        </button>
      )}

      {professional.plans.map((p) => (
        <button
          key={p.id}
          className={styles.planCard}
          disabled={!p.available}
          onClick={() => onSelect(p)}
        >
          {p.discountLabel && <div className={styles.planDiscount}>{p.discountLabel}</div>}
          <div className={styles.planRadioOuter}><div className={styles.planRadioInner} /></div>
          <div className={styles.planInfo}>
            <div className={styles.planTitle}>{p.label}</div>
            <div className={styles.planSub}>
              {fmtBRL(p.perSession)}/sessão
              {p.sessions > 1 && ` · +${p.sessions - 1} crédito${p.sessions - 1 > 1 ? "s" : ""}`}
            </div>
          </div>
          <div className={styles.planPrice}>{fmtBRL(p.value)}</div>
        </button>
      ))}

      <p className={styles.footnote}>💡 Créditos válidos por 60 dias após a compra</p>
    </div>
  );
}

function StepSlots({ loading, professional, plan, slotsByDay, sortedDays, onSelect }) {
  if (loading) return <div className={styles.loading}>Carregando horários…</div>;
  if (sortedDays.length === 0) {
    return (
      <div className={styles.emptyState}>
        <div className={styles.emptyEmoji}>📭</div>
        <p>Sem horários abertos no momento. Volta em alguns dias — {professional.name.split(" ")[0]} abre vagas semanalmente.</p>
      </div>
    );
  }
  return (
    <div>
      <div className={styles.agendaHeader}>
        <div className={`${styles.profAvatarSmall} ${styles[`avatar_${professional.id}`]}`}>
          <img src={professional.photo} alt="" onError={(e) => { e.target.style.display = "none"; }} />
        </div>
        <div>
          <div className={styles.agendaName}>{professional.name.split(" ")[0]} · {professional.spec.split(" · ")[0]}</div>
          <div className={styles.agendaMeta}>
            {professional.durationMin}min · {plan.id === "credit" ? "Crédito" : fmtBRL(plan.value)}
          </div>
        </div>
      </div>

      <div className={styles.timeline}>
        {sortedDays.map((date) => (
          <div key={date}>
            <div className={styles.timelineDayHdr}>{fmtDateDay(date)}</div>
            {slotsByDay[date].map((slot) => {
              const isAvailable = slot.status === "available";
              return (
                <button
                  key={slot.id}
                  className={`${styles.timelineRow} ${!isAvailable ? styles.timelineRowDisabled : ""}`}
                  disabled={!isAvailable}
                  onClick={() => isAvailable && onSelect({ ...slot })}
                >
                  <div className={styles.timelineTime}>
                    {slot.start}<br />{slot.end}
                  </div>
                  <div className={`${styles.timelineBar} ${isAvailable ? styles.timelineBarOk : styles.timelineBarOff}`} />
                  <div className={styles.timelineContent}>
                    <div className={`${styles.timelineTitle} ${isAvailable ? styles.timelineOk : styles.timelineOff}`}>
                      {isAvailable ? "Disponível" : "Indisponível"}
                    </div>
                    <div className={styles.timelineDesc}>
                      {professional.spec.split(" · ")[0]} · {professional.durationMin}min
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function StepConfirm({ professional, plan, slot, message, setMessage, submitting, error, onConfirm }) {
  return (
    <div>
      <div className={styles.confirmSummary}>
        <div className={styles.confirmRow}>
          <span className={styles.confirmLabel}>Profissional</span>
          <span className={styles.confirmValue}>{professional.name}</span>
        </div>
        <div className={styles.confirmRow}>
          <span className={styles.confirmLabel}>Serviço</span>
          <span className={styles.confirmValue}>{professional.spec.split(" · ")[0]} · {professional.durationMin}min</span>
        </div>
        <div className={styles.confirmRow}>
          <span className={styles.confirmLabel}>Quando</span>
          <span className={styles.confirmValue}>{fmtDateShort(slot.date)} · {slot.start}</span>
        </div>
        <div className={styles.confirmRow}>
          <span className={styles.confirmLabel}>Plano</span>
          <span className={styles.confirmValue}>{plan.label}</span>
        </div>
        <div className={styles.confirmRow}>
          <span className={styles.confirmLabel}>Total</span>
          <span className={styles.confirmTotal}>{plan.id === "credit" ? "Grátis (crédito)" : fmtBRL(plan.value)}</span>
        </div>
      </div>

      <div className={styles.formGroup}>
        <label className={styles.label}>Sobre o que tu quer falar? (opcional)</label>
        <textarea
          className={styles.textarea}
          placeholder="Ex: dor no joelho ao agachar, dúvida no supino, ansiedade no corte…"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={500}
        />
      </div>

      <div className={styles.cancelNote}>
        <b>⏱ Cancelamento:</b> até 24h antes da sessão = reembolso integral. Depois disso, sem reembolso.
      </div>
      <div className={styles.privacyNote}>
        <b>🔒 Privacidade:</b> outros alunos não veem teu nome nem que esse horário foi reservado por ti. Só o profissional e tu sabem.
      </div>

      {error && <div className={styles.error}>{error}</div>}

      <button
        className={styles.confirmBtn}
        onClick={onConfirm}
        disabled={submitting}
      >
        {submitting
          ? "Processando…"
          : plan.id === "credit"
            ? "Confirmar com crédito"
            : `Pagar ${fmtBRL(plan.value)} →`}
        {plan.id !== "credit" && <small>Você será levado pra Greenn</small>}
      </button>
    </div>
  );
}

function StepDone({ isCreditPayment, paymentLink }) {
  if (isCreditPayment) {
    return (
      <div className={styles.doneState}>
        <div className={styles.doneEmoji}>✅</div>
        <h2 className={styles.doneTitle}>Reservado!</h2>
        <p className={styles.doneSub}>
          Sua sessão tá confirmada. O link da reunião chega no WhatsApp antes da hora.
        </p>
      </div>
    );
  }
  return (
    <div className={styles.doneState}>
      <div className={styles.spinner} />
      <h2 className={styles.doneTitle}>Redirecionando…</h2>
      <p className={styles.doneSub}>
        Tu vai pagar de forma segura na <b>Greenn</b>. Vaga reservada por 15 minutos.
      </p>
      {paymentLink && (
        <a className={styles.linkFallback} href={paymentLink}>
          Não abriu? Clica aqui
        </a>
      )}
    </div>
  );
}
