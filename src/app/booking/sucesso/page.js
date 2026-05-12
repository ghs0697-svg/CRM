"use client";

import { useState, useEffect, useCallback } from "react";
import styles from "../booking.module.css";
import successStyles from "./sucesso.module.css";

/**
 * /booking/sucesso?ref=res_xxx
 *
 * Página pós-pagamento. Greenn redireciona pra cá com o external_reference
 * (que é o reservationId). Mostra detalhes do agendamento confirmado +
 * opção de cancelar.
 *
 * Estados possíveis:
 *   paid           → ✓ confirmado, mostra detalhes + botão cancelar
 *   pending        → ⏳ aguardando confirmação Greenn (raro — pagou mas
 *                       webhook ainda não chegou; mostra spinner + polling)
 *   canceled/expired → ✗ não confirmada
 */

function fmtDateFull(iso) {
  if (!iso) return "—";
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}
function fmtBRL(n) {
  return `R$ ${Number(n).toLocaleString("pt-BR")}`;
}

export default function SucessoPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reservation, setReservation] = useState(null);
  const [reservationId, setReservationId] = useState(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelMsg, setCancelMsg] = useState(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  // Captura ?ref ou ?id da URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("ref") || params.get("id") || params.get("external_reference");
    if (!ref) {
      setError("ID da reserva não encontrado na URL");
      setLoading(false);
      return;
    }
    setReservationId(ref);
  }, []);

  // Carrega dados da reserva
  const loadReservation = useCallback(async () => {
    if (!reservationId) return;
    try {
      const res = await fetch(`/api/booking/reservation?id=${encodeURIComponent(reservationId)}`);
      const data = await res.json();
      if (!data.ok) {
        setError(data.error || "Erro ao carregar reserva");
        setLoading(false);
        return;
      }
      setReservation(data.reservation);
      setLoading(false);
    } catch (err) {
      setError(String(err));
      setLoading(false);
    }
  }, [reservationId]);

  useEffect(() => {
    if (!reservationId) return;
    loadReservation();
  }, [reservationId, loadReservation]);

  // Polling se status = pending (aguarda webhook chegar)
  useEffect(() => {
    if (!reservation || reservation.paymentStatus !== "pending") return;
    const id = setInterval(loadReservation, 4000);
    return () => clearInterval(id);
  }, [reservation, loadReservation]);

  // Handler de cancelamento
  const handleCancel = useCallback(async () => {
    if (!reservation || cancelling) return;
    setCancelling(true);
    setCancelMsg(null);
    try {
      const res = await fetch("/api/booking/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reservationId: reservation.reservationId,
          studentPhone: reservation.studentPhone,
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        setCancelMsg({ type: "error", text: data.error || "Falha ao cancelar" });
        if (data.hoursUntil != null) {
          setCancelMsg({
            type: "error",
            text: `Sem reembolso: faltam só ${data.hoursUntil}h pra sessão (mínimo 24h pra reembolso integral).`,
          });
        }
      } else {
        setCancelMsg({
          type: "success",
          text: data.eligibleForRefund
            ? "Cancelado. Estorno será processado pela equipe."
            : "Cancelado.",
        });
        // Re-fetch pra atualizar status
        setTimeout(loadReservation, 800);
      }
    } catch (err) {
      setCancelMsg({ type: "error", text: String(err) });
    } finally {
      setCancelling(false);
      setShowCancelConfirm(false);
    }
  }, [reservation, cancelling, loadReservation]);

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div style={{ width: 32 }} />
        <h1 className={styles.headerTitle}>AGENDAMENTO</h1>
        <div style={{ width: 32 }} />
      </header>

      <main className={styles.main}>
        {loading && <div className={styles.loading}>Carregando agendamento…</div>}

        {!loading && error && (
          <div className={successStyles.errorState}>
            <div className={successStyles.errorEmoji}>⚠️</div>
            <h2 className={successStyles.title}>Não consegui carregar</h2>
            <p className={successStyles.sub}>{error}</p>
            <a className={successStyles.linkBtn} href="/booking">
              Voltar pro agendamento
            </a>
          </div>
        )}

        {!loading && !error && reservation && (
          <>
            {/* PENDING (raro) */}
            {reservation.paymentStatus === "pending" && (
              <div className={successStyles.pendingState}>
                <div className={successStyles.spinner} />
                <h2 className={successStyles.title}>Aguardando confirmação…</h2>
                <p className={successStyles.sub}>
                  A Greenn ainda não confirmou o pagamento. Geralmente leva alguns segundos. Se já pagou, espera um pouco que a página atualiza sozinha.
                </p>
              </div>
            )}

            {/* CONFIRMADO (paid / credit_used) */}
            {(reservation.paymentStatus === "paid" || reservation.paymentStatus === "credit_used") && !reservation.canceledAt && (
              <>
                <div className={successStyles.successHero}>
                  <div className={successStyles.checkBig}>✓</div>
                  <h2 className={successStyles.title}>Agendamento confirmado!</h2>
                  <p className={successStyles.sub}>
                    {reservation.paymentStatus === "credit_used"
                      ? "Sessão reservada com crédito do teu pacote."
                      : "Pagamento confirmado. Tua vaga tá garantida."}
                  </p>
                </div>

                <div className={successStyles.card}>
                  <div className={successStyles.profRow}>
                    <div className={`${styles.profAvatar} ${styles[`avatar_${reservation.professional.id}`]}`}>
                      <img
                        src={reservation.professional.photo}
                        alt={reservation.professional.name}
                        onError={(e) => { e.target.style.display = "none"; }}
                      />
                    </div>
                    <div>
                      <div className={successStyles.profName}>{reservation.professional.name}</div>
                      <div className={successStyles.profSpec}>{reservation.professional.spec}</div>
                    </div>
                  </div>

                  <div className={successStyles.detailRow}>
                    <span className={successStyles.detailLabel}>Quando</span>
                    <span className={successStyles.detailValue}>
                      {fmtDateFull(reservation.slotDate)}
                    </span>
                  </div>
                  <div className={successStyles.detailRow}>
                    <span className={successStyles.detailLabel}>Horário</span>
                    <span className={successStyles.detailValue}>
                      {reservation.slotStart} – {reservation.slotEnd}
                    </span>
                  </div>
                  <div className={successStyles.detailRow}>
                    <span className={successStyles.detailLabel}>Duração</span>
                    <span className={successStyles.detailValue}>
                      {reservation.professional.durationMin} min
                    </span>
                  </div>
                  {reservation.paymentStatus === "paid" && (
                    <div className={successStyles.detailRow}>
                      <span className={successStyles.detailLabel}>Valor pago</span>
                      <span className={successStyles.detailValue}>{fmtBRL(reservation.planValue)}</span>
                    </div>
                  )}
                  {reservation.message && (
                    <div className={successStyles.messageBox}>
                      <div className={successStyles.detailLabel}>Tu escreveu:</div>
                      <div className={successStyles.messageText}>{reservation.message}</div>
                    </div>
                  )}
                </div>

                <div className={successStyles.nextSteps}>
                  <div className={successStyles.stepRow}>
                    <span className={successStyles.stepIcon}>📱</span>
                    <div>
                      <div className={successStyles.stepTitle}>Link do Google Meet</div>
                      <div className={successStyles.stepSub}>Chega pelo teu WhatsApp algumas horas antes da sessão.</div>
                    </div>
                  </div>
                  <div className={successStyles.stepRow}>
                    <span className={successStyles.stepIcon}>⏱</span>
                    <div>
                      <div className={successStyles.stepTitle}>Tolerância de 10min</div>
                      <div className={successStyles.stepSub}>Atraso maior que 10min = perde a sessão.</div>
                    </div>
                  </div>
                  <div className={successStyles.stepRow}>
                    <span className={successStyles.stepIcon}>🔁</span>
                    <div>
                      <div className={successStyles.stepTitle}>Cancelamento até 24h antes</div>
                      <div className={successStyles.stepSub}>Reembolso integral. Menos que 24h = sem reembolso.</div>
                    </div>
                  </div>
                </div>

                {cancelMsg && (
                  <div className={cancelMsg.type === "error" ? successStyles.errorMsg : successStyles.successMsg}>
                    {cancelMsg.text}
                  </div>
                )}

                {!showCancelConfirm ? (
                  <button
                    className={successStyles.cancelBtn}
                    onClick={() => setShowCancelConfirm(true)}
                  >
                    Cancelar agendamento
                  </button>
                ) : (
                  <div className={successStyles.cancelConfirm}>
                    <p>Tem certeza? Reembolso só se cancelar até 24h antes.</p>
                    <div className={successStyles.cancelBtnRow}>
                      <button
                        className={successStyles.cancelKeepBtn}
                        onClick={() => setShowCancelConfirm(false)}
                        disabled={cancelling}
                      >
                        Manter
                      </button>
                      <button
                        className={successStyles.cancelConfirmBtn}
                        onClick={handleCancel}
                        disabled={cancelling}
                      >
                        {cancelling ? "Cancelando…" : "Sim, cancelar"}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* CANCELADO/EXPIRADO */}
            {(reservation.canceledAt || ["canceled", "expired", "refunded"].includes(reservation.paymentStatus)) && (
              <div className={successStyles.canceledState}>
                <div className={successStyles.canceledIcon}>✕</div>
                <h2 className={successStyles.title}>Agendamento cancelado</h2>
                <p className={successStyles.sub}>
                  Esta reserva foi cancelada. Tu pode agendar de novo quando quiser.
                </p>
                <a className={successStyles.linkBtn} href="/booking">
                  Novo agendamento
                </a>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
