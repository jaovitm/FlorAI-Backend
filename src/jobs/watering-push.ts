import type { Bindings } from "../types/env";
import { parseServiceAccount, sendData } from "../lib/fcm";
import { PLAN_LIMITS, PLANS } from "../lib/plans";
import { forgetPushToken } from "../lib/push";
import {
  currentDailySlot,
  isOverdue,
  latestScheduledOccurrence,
  needsWaterToday,
  type WateringSchedule,
} from "../lib/watering";

// Pushes de rega, disparados pelo cron a cada minuto. Duas categorias, um push por planta:
// - "scheduled": no horário escolhido pelo usuário no lembrete.
// - "daily": às 8h e às 18h (fuso do usuário), para plantas que precisam de rega hoje.
// O app monta a notificação (com o botão "Reguei") a partir dos dados.

/** Ocorrências mais antigas que isso não são avisadas (ex.: cron parado ou lembrete recém-criado). */
const STALE_MS = 2 * 60 * 60 * 1000;

type Category = "scheduled" | "daily";

type ReminderPushRow = WateringSchedule & {
  id: string;
  user_id: string;
  plant_id: string;
  plant_name: string;
  tz_offset: number;
  push_token: string;
  scheduled_push_key: string | null;
  daily_push_key: string | null;
};

type Push = { row: ReminderPushRow; category: Category; key: string; title: string; body: string };

const KEY_COLUMN: Record<Category, string> = {
  scheduled: "scheduled_push_key",
  daily: "daily_push_key",
};

/** Decide quais pushes cada lembrete deve receber agora. */
export function pendingPushes(rows: ReminderPushRow[], nowMs: number): Push[] {
  const pushes: Push[] = [];
  for (const row of rows) {
    const occurrence = latestScheduledOccurrence(row, row.tz_offset, nowMs);
    if (occurrence && occurrence.key !== row.scheduled_push_key && nowMs - occurrence.atMs < STALE_MS) {
      pushes.push({
        row,
        category: "scheduled",
        key: occurrence.key,
        title: "Hora de regar 💧",
        body: `${row.plant_name} está esperando por água.`,
      });
      // Acabou de receber o lembrete dele: não manda o aviso diário junto.
      continue;
    }

    const daily = currentDailySlot(row.tz_offset, nowMs);
    if (daily && daily.key !== row.daily_push_key && needsWaterToday(row, row.tz_offset, nowMs)) {
      const overdue = isOverdue(row, row.tz_offset, nowMs);
      pushes.push({
        row,
        category: "daily",
        key: daily.key,
        ...(daily.slot === "morning"
          ? {
              title: `${row.plant_name} precisa de água hoje 🌱`,
              body: overdue ? "A rega está atrasada." : "Hoje é dia de rega.",
            }
          : {
              title: `Não esqueça de regar: ${row.plant_name} 💧`,
              body: "Ainda não registramos a rega de hoje.",
            }),
      });
    }
  }
  return pushes;
}

export async function sendWateringPushes(env: Bindings, nowMs = Date.now()) {
  if (!env.FIREBASE_SERVICE_ACCOUNT) {
    console.warn("Push de rega ignorado: FIREBASE_SERVICE_ACCOUNT não configurado.");
    return { sent: 0, failed: 0 };
  }
  const account = parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT);
  const plans = PLANS.filter((plan) => PLAN_LIMITS[plan].wateringAlerts);

  const { results } = await env.DB.prepare(
    `SELECT r.id, r.user_id, r.plant_id, r.interval_days, r.hour, r.minute, r.last_watered_at, r.created_at,
       r.scheduled_push_key, r.daily_push_key, p.plant_name, u.tz_offset, u.push_token
     FROM reminders r
     JOIN users u ON u.id = r.user_id
     JOIN plants p ON p.id = r.plant_id
     LEFT JOIN subscriptions s ON s.user_id = r.user_id
     WHERE u.push_token IS NOT NULL AND COALESCE(s.plan, 'free') IN (${plans.map(() => "?").join(", ")})`,
  )
    .bind(...plans)
    .all<ReminderPushRow>();

  const pushes = pendingPushes(results, nowMs);
  const outcomes = await Promise.all(
    pushes.map(async (push) => ({
      push,
      result: await sendData(account, push.row.push_token, {
        type: "watering",
        category: push.category,
        reminderId: push.row.id,
        plantId: push.row.plant_id,
        plantName: push.row.plant_name,
        title: push.title,
        body: push.body,
      }).catch((error: unknown) => ({ ok: false as const, invalidToken: false, status: 0, error: String(error) })),
    })),
  );

  const updates: D1PreparedStatement[] = [];
  const forgotten = new Set<string>();
  let failed = 0;
  for (const { push, result } of outcomes) {
    if (result.ok) {
      updates.push(
        env.DB.prepare(`UPDATE reminders SET ${KEY_COLUMN[push.category]} = ? WHERE id = ?`).bind(push.key, push.row.id),
      );
      continue;
    }
    failed++;
    if (result.invalidToken && !forgotten.has(push.row.user_id)) {
      forgotten.add(push.row.user_id);
      await forgetPushToken(env.DB, push.row.user_id, push.row.push_token);
    } else if (!result.invalidToken) {
      // Erro temporário: a chave não é gravada e o envio é tentado de novo no próximo minuto.
      console.error(`Push de rega falhou (${push.row.id}): ${result.status} ${result.error}`);
    }
  }
  if (updates.length) await env.DB.batch(updates);
  return { sent: pushes.length - failed, failed };
}
