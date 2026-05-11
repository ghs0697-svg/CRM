/**
 * Booking — sistema de agendamento de profissionais (Personal, Psicóloga).
 *
 * Storage: Vercel KV (Upstash Redis).
 *
 * Schema das chaves no KV:
 *   booking:slots:<profId>:<YYYY-MM-DD>
 *     → array de slots: [{ id, start, end, status, reservationId? }]
 *
 *   booking:reservation:<reservationId>
 *     → { reservationId, professionalId, slotDate, slotId, slotStart, slotEnd,
 *         planId, planSessions, planValue, studentName, studentPhone,
 *         studentSubscriberId, message, paymentStatus, paymentLinkGreenn,
 *         externalRef, createdAt, expiresAt, confirmedAt?, canceledAt?,
 *         refundedAt? }
 *
 *   booking:credits:<phone>:<profId>
 *     → { remaining: <number>, expiresAt: <ISO> } — créditos do pacote
 *
 *   booking:reservations-by-phone:<phone>
 *     → array de reservationIds (índice pra listar agendamentos do aluno)
 *
 * Privacidade: aluno só vê slots como `available` ou `taken` — nunca vê quem
 * reservou. Endpoints admin (com BOOKING_ADMIN_SECRET) retornam dados completos
 * incluindo nome do aluno.
 *
 * Planos: cada profissional define uma lista de planos. Plano com sessions=1
 * é avulso; sessions>1 é pacote (gera créditos extras = sessions - 1).
 */

import { kv as kvLib } from "@vercel/kv";

const useKV = !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);

// Validade de créditos do pacote (em dias) — configurável via env.
// Default 60 dias: aluno tem 2 meses pra usar tudo, depois perde.
const CREDIT_VALIDITY_DAYS = parseInt(process.env.BOOKING_CREDIT_VALIDITY_DAYS || "60", 10);

// ── Config dos profissionais ──────────────────────────────────────────────
// Cada profissional tem array `plans`. Plano id é único dentro do profissional
// (ex: "1x", "2x", "4x", "8x"). Plano com sessions=1 é a aula avulsa.
//
// greennLink fica vazio até o link de checkout ser criado e plugado.
// Editável via env var BOOKING_PROFESSIONALS (JSON) ou usa default abaixo.
const DEFAULT_PROFESSIONALS = [
  {
    id: "vitor",
    name: "Vitor Luis Rosado",
    spec: "Personal Trainer · CREF",
    bio: "Especialista em biomecânica e hipertrofia. Treina alunos do Método GH desde a fundação. Aulas 1-on-1 pra travar técnica, destravar plateau e adaptar pra dor/lesão.",
    durationMin: 45,
    weeklySlots: 4,
    photo: "/img/vitor.jpg",
    active: true,
    plans: [
      { id: "1x", sessions: 1, value: 50,  perSession: 50, label: "1 aula",     greennLink: "https://payfast.greenn.com.br/hvbk685/offer/VU5uQA" },
      { id: "2x", sessions: 2, value: 90,  perSession: 45, label: "2 aulas",    greennLink: "https://payfast.greenn.com.br/hvbk685/offer/DNjnsr", discountLabel: "-10%" },
      { id: "4x", sessions: 4, value: 160, perSession: 40, label: "4 aulas",    greennLink: "https://payfast.greenn.com.br/hvbk685/offer/dFIy7C", discountLabel: "-20%" },
      { id: "8x", sessions: 8, value: 280, perSession: 35, label: "8 aulas",    greennLink: "https://payfast.greenn.com.br/hvbk685/offer/lrOeSw", discountLabel: "-30%" },
    ],
  },
  {
    id: "bruna",
    name: "Bruna Garzella Michael",
    spec: "Psicóloga · CRP · Performance",
    bio: "Atende alunos do Método GH em sessões breves focadas em ansiedade alimentar, controle emocional no corte/bulk, motivação e relação saudável com o treino. Abordagem direta, sem enrolação.",
    durationMin: 30,
    weeklySlots: 8,
    photo: "/img/bruna.jpg",
    active: true,
    plans: [
      { id: "1x", sessions: 1, value: 100, perSession: 100, label: "1 sessão",  greennLink: "https://payfast.greenn.com.br/t6d49r2/offer/ZVMjI9" },
      { id: "2x", sessions: 2, value: 180, perSession: 90,  label: "2 sessões", greennLink: "https://payfast.greenn.com.br/t6d49r2/offer/19NchO", discountLabel: "-10%" },
      { id: "4x", sessions: 4, value: 320, perSession: 80,  label: "4 sessões", greennLink: "https://payfast.greenn.com.br/t6d49r2/offer/FhNZ6f", discountLabel: "-20%" },
    ],
  },
];

export function getProfessionals({ includeInactive = false } = {}) {
  // Sobrescreve via env var se quiser editar sem redeploy
  let pros = DEFAULT_PROFESSIONALS;
  if (process.env.BOOKING_PROFESSIONALS) {
    try {
      pros = JSON.parse(process.env.BOOKING_PROFESSIONALS);
    } catch {
      // ignora — usa default
    }
  }
  return includeInactive ? pros : pros.filter((p) => p.active);
}

export function getProfessional(profId) {
  return getProfessionals({ includeInactive: true }).find((p) => p.id === profId);
}

/**
 * Retorna config de um plano específico de um profissional.
 * Ex: getPlan('vitor', '4x') → { id, sessions, value, perSession, ... }
 */
export function getPlan(profId, planId) {
  const prof = getProfessional(profId);
  if (!prof) return null;
  return prof.plans.find((p) => p.id === planId) || null;
}

// ── Helpers internos ──────────────────────────────────────────────────────
function onlyDigitsPhone(s) {
  return String(s || "").replace(/\D/g, "").slice(-10);
}

function isoDate(d) {
  return new Date(d).toISOString().split("T")[0];
}

function nowIso() {
  return new Date().toISOString();
}

function genId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ── KV ops ────────────────────────────────────────────────────────────────
async function kvGet(key) {
  if (!useKV) return null;
  return kvLib.get(key);
}

async function kvSet(key, val) {
  if (!useKV) return;
  await kvLib.set(key, val);
}

async function kvDel(key) {
  if (!useKV) return;
  await kvLib.del(key);
}

async function kvScan(pattern) {
  if (!useKV) return [];
  const keys = [];
  let cursor = 0;
  do {
    const res = await kvLib.scan(cursor, { match: pattern, count: 100 });
    cursor = Number(res[0]);
    keys.push(...res[1]);
  } while (cursor !== 0);
  return keys;
}

// ── Slots (agenda dos profissionais) ──────────────────────────────────────
const slotsKey = (profId, date) => `booking:slots:${profId}:${date}`;

/**
 * Adiciona um slot na agenda do profissional.
 * Usado pelo painel admin do profissional pra cadastrar disponibilidade.
 */
export async function addSlot(profId, { date, start, end }) {
  const key = slotsKey(profId, date);
  const slots = (await kvGet(key)) || [];
  const id = genId("slot");
  slots.push({
    id,
    start, // ISO time HH:MM
    end,
    status: "available",
    reservationId: null,
  });
  // Ordena por start
  slots.sort((a, b) => a.start.localeCompare(b.start));
  await kvSet(key, slots);
  return { id, date, start, end };
}

/**
 * Remove um slot da agenda. Só permite se ainda for `available`.
 */
export async function removeSlot(profId, date, slotId) {
  const key = slotsKey(profId, date);
  const slots = (await kvGet(key)) || [];
  const idx = slots.findIndex((s) => s.id === slotId);
  if (idx === -1) return { ok: false, error: "slot não encontrado" };
  if (slots[idx].status !== "available") {
    return { ok: false, error: "slot já reservado/confirmado — não pode apagar" };
  }
  slots.splice(idx, 1);
  await kvSet(key, slots);
  return { ok: true };
}

/**
 * Retorna slots de um profissional numa janela de datas.
 *
 * Sanitização de privacidade: por padrão retira dados privados (reservationId,
 * studentName etc). Se `includePrivate=true`, retorna tudo (uso admin).
 */
export async function getSlots(profId, { from, to, includePrivate = false } = {}) {
  const today = isoDate(new Date());
  const fromDate = from || today;
  const toDate = to || isoDate(new Date(Date.now() + 14 * 86400000)); // 14 dias default

  const result = [];
  let cursor = new Date(fromDate);
  const end = new Date(toDate);
  while (cursor <= end) {
    const date = isoDate(cursor);
    const slots = (await kvGet(slotsKey(profId, date))) || [];
    for (const s of slots) {
      if (includePrivate) {
        result.push({ ...s, date });
      } else {
        // Privacidade: aluno só vê o status (sem nome/reservationId)
        result.push({
          id: s.id,
          date,
          start: s.start,
          end: s.end,
          status: s.status,
        });
      }
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return result;
}

/**
 * Marca um slot específico com status novo (pending/confirmed/available).
 * Atomic-ish (KV não tem transações, mas pra esse uso é OK).
 */
export async function updateSlotStatus(profId, date, slotId, patch) {
  const key = slotsKey(profId, date);
  const slots = (await kvGet(key)) || [];
  const idx = slots.findIndex((s) => s.id === slotId);
  if (idx === -1) return { ok: false, error: "slot não encontrado" };
  slots[idx] = { ...slots[idx], ...patch };
  await kvSet(key, slots);
  return { ok: true, slot: slots[idx] };
}

// ── Reservas ──────────────────────────────────────────────────────────────
const reservationKey = (id) => `booking:reservation:${id}`;
const phoneIdxKey = (phone) => `booking:reservations-by-phone:${onlyDigitsPhone(phone)}`;

const RESERVATION_TTL_MIN = 15;

/**
 * Cria uma reserva pendente. Slot vira `pending` por 15min — se aluno não
 * pagar nesse prazo, libera (cleanup via cron ou lazy expire na próxima leitura).
 *
 * Retorna { reservationId, paymentLink, externalRef }.
 */
export async function createReservation({
  professionalId,
  slotDate,
  slotId,
  planId, // ex: "1x" / "2x" / "4x" / "8x" / "credit"
  studentName,
  studentPhone,
  studentSubscriberId,
  message,
}) {
  const prof = getProfessional(professionalId);
  if (!prof) return { ok: false, error: "profissional não encontrado" };

  // Verifica slot
  const slots = (await kvGet(slotsKey(professionalId, slotDate))) || [];
  const slot = slots.find((s) => s.id === slotId);
  if (!slot) return { ok: false, error: "slot não encontrado" };
  if (slot.status !== "available") {
    return { ok: false, error: "slot indisponível" };
  }

  const isCreditPayment = planId === "credit";

  // Se for crédito, valida saldo
  if (isCreditPayment) {
    const c = await getCredits(studentPhone, professionalId);
    if (c <= 0) {
      return { ok: false, error: "sem créditos disponíveis com esse profissional" };
    }
  }

  // Se for plano pago, valida que existe e tem link
  let plan = null;
  if (!isCreditPayment) {
    plan = getPlan(professionalId, planId);
    if (!plan) {
      return { ok: false, error: `plano ${planId} não existe pra ${prof.name}` };
    }
    if (!plan.greennLink) {
      return {
        ok: false,
        error: `Greenn ainda não configurado pro plano ${planId} de ${prof.name}`,
      };
    }
  }

  const reservationId = genId("res");
  const externalRef = reservationId; // mandamos pra Greenn como external_reference

  const reservation = {
    reservationId,
    externalRef,
    professionalId,
    professionalName: prof.name,
    slotDate,
    slotId,
    slotStart: slot.start,
    slotEnd: slot.end,
    planId: isCreditPayment ? "credit" : plan.id,
    planSessions: isCreditPayment ? 1 : plan.sessions,
    planValue: isCreditPayment ? 0 : plan.value,
    studentName: String(studentName || "").trim(),
    studentPhone: onlyDigitsPhone(studentPhone),
    studentSubscriberId: studentSubscriberId || null,
    message: String(message || "").trim(),
    paymentStatus: isCreditPayment ? "credit_used" : "pending",
    paymentLinkGreenn: isCreditPayment ? null : plan.greennLink,
    createdAt: nowIso(),
    expiresAt: new Date(Date.now() + RESERVATION_TTL_MIN * 60_000).toISOString(),
    confirmedAt: null,
    canceledAt: null,
    refundedAt: null,
  };

  // Marca slot como pending (ou taken se for crédito — já confirma)
  await updateSlotStatus(professionalId, slotDate, slotId, {
    status: isCreditPayment ? "taken" : "pending",
    reservationId,
  });

  // Salva reserva
  await kvSet(reservationKey(reservationId), reservation);

  // Indexa por telefone
  const phoneList = (await kvGet(phoneIdxKey(studentPhone))) || [];
  phoneList.unshift(reservationId);
  await kvSet(phoneIdxKey(studentPhone), phoneList);

  // Se for crédito, debita e confirma imediatamente
  if (isCreditPayment) {
    await consumeCredit(studentPhone, professionalId);
    reservation.confirmedAt = nowIso();
    await kvSet(reservationKey(reservationId), reservation);
  }

  return {
    ok: true,
    reservationId,
    externalRef,
    paymentLink: reservation.paymentLinkGreenn,
    isCreditPayment,
    expiresAt: reservation.expiresAt,
  };
}

export async function getReservation(reservationId) {
  return kvGet(reservationKey(reservationId));
}

export async function getReservationsByPhone(phone, { upcomingOnly = false } = {}) {
  const ids = (await kvGet(phoneIdxKey(phone))) || [];
  const items = [];
  const today = isoDate(new Date());
  for (const id of ids) {
    const r = await getReservation(id);
    if (!r) continue;
    if (upcomingOnly && r.slotDate < today) continue;
    if (upcomingOnly && r.canceledAt) continue;
    items.push(r);
  }
  return items;
}

/**
 * Confirma reserva paga (via webhook Greenn).
 * Slot vira `taken`. Se for pacote, adiciona créditos.
 */
export async function confirmReservation(reservationId, { paymentTransactionId } = {}) {
  const r = await getReservation(reservationId);
  if (!r) return { ok: false, error: "reserva não encontrada" };
  if (r.confirmedAt) return { ok: true, reservation: r, alreadyConfirmed: true };

  r.paymentStatus = "paid";
  r.paymentTransactionId = paymentTransactionId || null;
  r.confirmedAt = nowIso();
  await kvSet(reservationKey(reservationId), r);

  // Slot fica taken (já estava pending; confirma)
  await updateSlotStatus(r.professionalId, r.slotDate, r.slotId, {
    status: "taken",
  });

  // Se o plano comprado tem >1 sessão, soma créditos extras
  // (essa 1° já foi "consumida" virando a reserva atual; sobram sessions-1)
  const extraCredits = (r.planSessions || 1) - 1;
  if (extraCredits > 0) {
    await addCredits(r.studentPhone, r.professionalId, extraCredits);
  }

  return { ok: true, reservation: r };
}

/**
 * Libera reserva (pagamento falhou/expirou ou aluno cancelou).
 * Slot volta a `available`. Se for cancelamento <24h, marca canceledAt mas
 * NÃO libera o slot (pq o aluno perdeu a vaga).
 */
export async function releaseReservation(reservationId, reason = "expired") {
  const r = await getReservation(reservationId);
  if (!r) return { ok: false, error: "reserva não encontrada" };

  r.paymentStatus = reason === "canceled" ? "canceled" : "expired";
  r.canceledAt = nowIso();
  await kvSet(reservationKey(reservationId), r);

  // Libera o slot (volta a available)
  await updateSlotStatus(r.professionalId, r.slotDate, r.slotId, {
    status: "available",
    reservationId: null,
  });

  return { ok: true, reservation: r };
}

/**
 * Aluno cancela reserva. Se >24h antes, marca pra reembolso e libera slot.
 * Se <24h, retorna erro pra UI bloquear.
 */
export async function cancelReservation(reservationId, { byStudentPhone } = {}) {
  const r = await getReservation(reservationId);
  if (!r) return { ok: false, error: "reserva não encontrada" };
  if (byStudentPhone && onlyDigitsPhone(byStudentPhone) !== r.studentPhone) {
    return { ok: false, error: "telefone não bate com o da reserva" };
  }
  if (r.canceledAt) return { ok: false, error: "já cancelada" };

  // Calcula horas até o slot
  const slotDateTime = new Date(`${r.slotDate}T${r.slotStart}:00`);
  const hoursUntil = (slotDateTime - new Date()) / 3_600_000;
  if (hoursUntil < 24) {
    return {
      ok: false,
      error: "cancelamento com menos de 24h não permite reembolso",
      hoursUntil: Math.round(hoursUntil * 10) / 10,
    };
  }

  // Marca como cancelada e libera slot
  await releaseReservation(reservationId, "canceled");

  // Se era pacote ou avulso pago, marca pra reembolso (estorno via Greenn API
  // tratado em /api/booking/cancel — aqui só registra)
  return { ok: true, eligibleForRefund: r.paymentStatus === "paid" };
}

// ── Créditos (pacotes multi-sessão) ───────────────────────────────────────
// Créditos têm validade de CREDIT_VALIDITY_DAYS (default 60). Sempre que
// addCredits roda, renova a data de expiração da pilha inteira pra
// 60 dias a partir da última compra. Aluno que comprar pacote novo
// "reseta" o relógio dos créditos antigos junto.
const creditsKey = (phone, profId) =>
  `booking:credits:${onlyDigitsPhone(phone)}:${profId}`;

function creditsExpired(creditsObj) {
  if (!creditsObj || !creditsObj.expiresAt) return false;
  return new Date(creditsObj.expiresAt) < new Date();
}

export async function getCredits(phone, profId) {
  const c = await kvGet(creditsKey(phone, profId));
  if (!c) return 0;
  if (creditsExpired(c)) {
    // Lazy cleanup — zera créditos vencidos quando ninguém olha
    await kvDel(creditsKey(phone, profId));
    return 0;
  }
  return c.remaining || 0;
}

export async function addCredits(phone, profId, amount) {
  const key = creditsKey(phone, profId);
  const existing = (await kvGet(key)) || { remaining: 0 };
  // Se créditos existentes estavam expirados, ignora o saldo antigo
  const baseRemaining = creditsExpired(existing) ? 0 : (existing.remaining || 0);
  const next = {
    remaining: baseRemaining + amount,
    updatedAt: nowIso(),
    expiresAt: new Date(Date.now() + CREDIT_VALIDITY_DAYS * 86_400_000).toISOString(),
  };
  await kvSet(key, next);
  return next.remaining;
}

export async function consumeCredit(phone, profId) {
  const key = creditsKey(phone, profId);
  const c = await kvGet(key);
  if (!c || creditsExpired(c) || c.remaining <= 0) {
    return { ok: false, error: "sem créditos" };
  }
  c.remaining -= 1;
  c.updatedAt = nowIso();
  // NÃO renova expiresAt no consumo — só na compra. Aluno tem 60 dias do
  // dia do pacote pra usar; consumir não estende.
  if (c.remaining > 0) {
    await kvSet(key, c);
  } else {
    await kvDel(key); // limpa quando acaba
  }
  return { ok: true, remaining: c.remaining };
}

/**
 * Retorna detalhe completo dos créditos (saldo + expiração) pra mostrar
 * pro aluno na UI.
 */
export async function getCreditsDetail(phone, profId) {
  const c = await kvGet(creditsKey(phone, profId));
  if (!c || creditsExpired(c)) return { remaining: 0, expiresAt: null };
  return { remaining: c.remaining || 0, expiresAt: c.expiresAt || null };
}

// ── Auth helpers ──────────────────────────────────────────────────────────
export function isAdminAuthorized(req) {
  const expected = process.env.BOOKING_ADMIN_SECRET;
  if (!expected) return false;
  const authHeader = req.headers.get?.("authorization") || "";
  const headerToken = authHeader.replace(/^Bearer\s+/i, "").trim();
  const url = new URL(req.url);
  const queryToken = url.searchParams.get("secret") || "";
  return headerToken === expected || queryToken === expected;
}

// ── Cleanup de reservas expiradas (idempotente) ───────────────────────────
/**
 * Varre reservations e libera as que estão pending mas já passou expiresAt.
 * Pode ser chamado de um cron ou na lazy basis (antes de cada list de slots).
 */
export async function cleanupExpiredReservations() {
  const keys = await kvScan("booking:reservation:*");
  const released = [];
  const now = new Date();
  for (const key of keys) {
    const r = await kvGet(key);
    if (!r) continue;
    if (r.paymentStatus !== "pending") continue;
    if (!r.expiresAt) continue;
    if (new Date(r.expiresAt) > now) continue;
    await releaseReservation(r.reservationId, "expired");
    released.push(r.reservationId);
  }
  return { released };
}
