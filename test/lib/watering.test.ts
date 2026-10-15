import { describe, expect, it } from "vitest";
import {
  currentDailySlot,
  isOverdue,
  latestScheduledOccurrence,
  needsWaterToday,
  type WateringSchedule,
} from "../../src/lib/watering";

const BRT = -180; // UTC-3
/** Instante UTC a partir de um horário de Brasília. */
const brt = (iso: string) => Date.parse(`${iso}-03:00`);

const schedule = (overrides: Partial<WateringSchedule> = {}): WateringSchedule => ({
  interval_days: 3,
  hour: 9,
  minute: 30,
  // Regada em 01/05 às 22h de Brasília (já 02/05 em UTC).
  last_watered_at: "2026-05-02T01:00:00.000Z",
  created_at: "2026-04-01T00:00:00.000Z",
  ...overrides,
});

describe("needsWaterToday / isOverdue", () => {
  it("usa o dia local da última rega + intervalo", () => {
    // 01/05 (local) + 3 dias = 04/05.
    expect(needsWaterToday(schedule(), BRT, brt("2026-05-03T23:59:00"))).toBe(false);
    expect(needsWaterToday(schedule(), BRT, brt("2026-05-04T00:00:00"))).toBe(true);
    expect(isOverdue(schedule(), BRT, brt("2026-05-04T20:00:00"))).toBe(false);
    expect(isOverdue(schedule(), BRT, brt("2026-05-05T08:00:00"))).toBe(true);
  });

  it("sem rega registrada conta a partir da criação", () => {
    const s = schedule({ last_watered_at: null, created_at: "2026-05-10T12:00:00.000Z", interval_days: 2 });
    expect(needsWaterToday(s, BRT, brt("2026-05-11T12:00:00"))).toBe(false);
    expect(needsWaterToday(s, BRT, brt("2026-05-12T00:00:00"))).toBe(true);
  });
});

describe("latestScheduledOccurrence", () => {
  it("é null antes do horário do dia previsto", () => {
    expect(latestScheduledOccurrence(schedule(), BRT, brt("2026-05-04T09:29:00"))).toBeNull();
  });

  it("no dia previsto, depois do horário escolhido", () => {
    const now = brt("2026-05-04T09:31:00");
    expect(latestScheduledOccurrence(schedule(), BRT, now)).toEqual({
      key: "2026-05-04T09:30",
      atMs: brt("2026-05-04T09:30:00"),
    });
  });

  it("sem rega, repete a cada intervalo", () => {
    expect(latestScheduledOccurrence(schedule(), BRT, brt("2026-05-06T10:00:00"))?.key).toBe("2026-05-04T09:30");
    expect(latestScheduledOccurrence(schedule(), BRT, brt("2026-05-07T09:30:00"))?.key).toBe("2026-05-07T09:30");
  });
});

describe("currentDailySlot", () => {
  it("manhã às 8h e noite às 18h no fuso do usuário", () => {
    expect(currentDailySlot(BRT, brt("2026-05-04T08:05:00"))).toEqual({ slot: "morning", key: "2026-05-04:morning" });
    expect(currentDailySlot(BRT, brt("2026-05-04T18:59:00"))).toEqual({ slot: "evening", key: "2026-05-04:evening" });
    expect(currentDailySlot(BRT, brt("2026-05-04T12:00:00"))).toBeNull();
  });
});
