// Calendário de rega no fuso do usuário. Instantes "locais" são ms UTC deslocados
// pelo `tz_offset` (minutos), lidos com os getters UTC — mesma regra do app
// (`WateringReminder.nextWateringAt`/`upcoming`).

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

export type WateringSchedule = {
  interval_days: number;
  hour: number;
  minute: number;
  last_watered_at: string | null;
  created_at: string;
};

export type DailySlot = "morning" | "evening";

/** Hora local em que sai o aviso diário de cada turno. */
export const DAILY_SLOT_HOURS: Record<DailySlot, number> = { morning: 8, evening: 18 };

const toLocal = (utcMs: number, tzOffset: number) => utcMs + tzOffset * MINUTE_MS;
const startOfDay = (localMs: number) => Math.floor(localMs / DAY_MS) * DAY_MS;

/** `yyyy-MM-dd` de um instante local. */
export const localDayKey = (localMs: number) => new Date(localMs).toISOString().slice(0, 10);

/** Início (local) do dia da próxima rega: dia da última rega + intervalo. Sem rega, conta da criação. */
export function dueDay(schedule: WateringSchedule, tzOffset: number): number {
  const base = Date.parse(schedule.last_watered_at ?? schedule.created_at);
  return startOfDay(toLocal(base, tzOffset)) + schedule.interval_days * DAY_MS;
}

/** A planta precisa de rega hoje (ou está atrasada). */
export const needsWaterToday = (schedule: WateringSchedule, tzOffset: number, nowMs: number) =>
  dueDay(schedule, tzOffset) <= startOfDay(toLocal(nowMs, tzOffset));

/** Rega atrasada: o dia previsto já passou. */
export const isOverdue = (schedule: WateringSchedule, tzOffset: number, nowMs: number) =>
  dueDay(schedule, tzOffset) < startOfDay(toLocal(nowMs, tzOffset));

/**
 * Última ocorrência já passada do horário escolhido (dia previsto às hh:mm, repetindo a
 * cada intervalo enquanto não houver rega). `null` antes da primeira ocorrência.
 */
export function latestScheduledOccurrence(
  schedule: WateringSchedule,
  tzOffset: number,
  nowMs: number,
): { key: string; atMs: number } | null {
  const nowLocal = toLocal(nowMs, tzOffset);
  const first = dueDay(schedule, tzOffset) + (schedule.hour * 60 + schedule.minute) * MINUTE_MS;
  if (nowLocal < first) return null;
  const step = schedule.interval_days * DAY_MS;
  const local = first + Math.floor((nowLocal - first) / step) * step;
  return { key: new Date(local).toISOString().slice(0, 16), atMs: local - tzOffset * MINUTE_MS };
}

/** Turno do aviso diário em andamento (durante a hora local do turno), ou `null`. */
export function currentDailySlot(tzOffset: number, nowMs: number): { slot: DailySlot; key: string } | null {
  const local = toLocal(nowMs, tzOffset);
  const hour = new Date(local).getUTCHours();
  const slot = (Object.keys(DAILY_SLOT_HOURS) as DailySlot[]).find((s) => DAILY_SLOT_HOURS[s] === hour);
  return slot ? { slot, key: `${localDayKey(local)}:${slot}` } : null;
}
