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
 *         plan: 'avulso'|'pacote', studentName, studentPhone, studentSubscriberId,
 *         message, paymentStatus, paymentLinkGreenn, externalRef,
 *         createdAt, expiresAt, confirmedAt?, canceledAt?, refundedAt? }
 *
 *   booking:credits:<phone>:<profId>
 *     → { remaining: <number> } — créditos disponíveis do pacote 4×
 *
 *   booking:reservations-by-phone:<phone>
 *     → array de reservationIds (índice pra listar agendamentos do aluno)
 *
 * Privacidade: aluno só vê slots como `available` ou `taken` — nunca vê quem
 * reservou. Endpoints admin (com BOOKING_ADMIN_SECRET) retornam dados completos
 * incluindo nome do aluno.
 */

import { kv as kvLib } from "@vercel/kv";

const useKV = !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);

// ── Config dos profissionais ──────────────────────────────────────────────
// Editável via env var BOOKING_PROFESSIONALS (JSON) ou usa default abaixo.
// Greenn links ficam vazios até GH criar os produtos e me passar.
const DEFAULT_PROFESSIONALS = [
  {
    id: "vitor",
    name: "Vitor Luis Rosado",
    spec: "Personal Trainer · CREF",
    bio: "Especialista em biomecânica e hipertrofia. Treina alunos do Método GH desde a fundação. Aulas 1-on-1 pra travar técnica, destravar plateau e adaptar pra dor/lesão.",
    durationMin: 45,
    pricing: {
      avulso: { value: 50, label: "Aula avulsa", greennLink: "" },
      pacote4: {
        value: 150,
        label: "Pacote 4 aulas",
        credits: 4,
        greennLink: "",
        discountLabel: "-25%",
      },
    },
    weeklySlots: 4,
    photo: "/img/vitor.jpg",
    active: true,
  },
  {
    id: "bruna",
    name: "Bruna Garzella Michael",
    spec: "Psicóloga · CRP · Performance",
    bio: "Atende alunos do Método GH em sessões breves focadas em ansiedade alimentar, controle emocional no corte/bulk, motivação e relação saudável com o treino. Abordagem direta, sem enrolação.",
    durationMin: 30,
    pricing: {
      avulso: { value: 80, label: "Sessão avulsa", greennLink: "" },
      pacote4: {
        value: 300,
        label: "Pacote 4 sessões",
        credits: 4,
        greennLink: "",
        discountLabel: "-6%",
      },
    },
    weeklySlots: 8,
    photo: "/img/bruna.jpg",
    active: true,
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
  plan, // 'avulso' | 'pacote'
  studentName,
  studentPhone,
  studentSubscriberId,
  message,
  useCredit = false, // se true, não gera link de pagamento (paga com crédito de pacote)
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

  // Se é pacote ou avulso, mas usando crédito? Verifica saldo.
  let isCreditPayment = false;
  if (useCredit) {
    const credits = (await kvGet(`booking:credits:${onlyDigitsPhone(studentPhone)}:${professionalId}`)) || { remaining: 0 };
    if (credits.remaining <= 0) {
      return { ok: false, error: "sem créditos disponíveis com esse profissional" };
    }
    isCreditPayment = true;
  }

  const reservationId = genId("res");
  const externalRef = reservationId; // mandamos esse pra Greenn como external_reference

  const planConfig =
    plan === "pacote" ? prof.pricing.pacote4 : prof.pricing.avulso;

  const reservation = {
    reservationId,
    externalRef,
    professionalId,
    professionalName: prof.name,
    slotDate,
    slotId,
    slotStart: slot.start,
    slotEnd: slot.end,
    plan: isCreditPayment ? "credit" : plan,
    planValue: isCreditPayment ? 0 : planConfig.value,
    studentName: String(studentName || "").trim(),
    studentPhone: onlyDigitsPhone(studentPhone),
    studentSubscriberId: studentSubscriberId || null,
    message: String(message || "").trim(),
    paymentStatus: isCreditPayment ? "credit_used" : "pending",
    paymentLinkGreenn: isCreditPayment ? null : (planConfig.greennLink || null),
    createdAt: nowIso(),
    expiresAt: new Date(Date.now() + RESERVATION_TTL_MIN * 60_000).toISOString(),
    confirmedAt: null,
    canceledAt: null,
    refundedAt: null,
  };

  // Marca slot como pending
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

  // Se for crédito, debita imediatamente e confirma
  if (isCreditPayment) {
    await consumeCredit(studentPhone, professionalId);
    reservation.paymentStatus = "credit_used";
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

  // Se for pacote, soma créditos extras (3 — esse 1° já foi consumido pra essa reserva)
  if (r.plan === "pacote") {
    const prof = getProfessional(r.professionalId);
    const extraCredits = (prof?.pricing?.pacote4?.credits || 4) - 1;
    if (extraCredits > 0) {
      await addCredits(r.studentPhone, r.professionalId, extraCredits);
    }
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

// ── Créditos (pacote 4×) ──────────────────────────────────────────────────
const creditsKey = (phone, profId) =>
  `booking:credits:${onlyDigitsPhone(phone)}:${profId}`;

export async function getCredits(phone, profId) {
  const c = (await kvGet(creditsKey(phone, profId))) || { remaining: 0 };
  return c.remaining;
}

export async function addCredits(phone, profId, amount) {
  const key = creditsKey(phone, profId);
  const c = (await kvGet(key)) || { remaining: 0 };
  c.remaining += amount;
  c.updatedAt = nowIso();
  await kvSet(key, c);
  return c.remaining;
}

export async function consumeCredit(phone, profId) {
  const key = creditsKey(phone, profId);
  const c = (await kvGet(key)) || { remaining: 0 };
  if (c.remaining <= 0) return { ok: false, error: "sem créditos" };
  c.remaining -= 1;
  c.updatedAt = nowIso();
  await kvSet(key, c);
  return { ok: true, remaining: c.remaining };
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
