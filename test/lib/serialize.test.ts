import { describe, expect, it } from "vitest";
import { ApiError, notFound, planLimit, unauthorized, validationError } from "../../src/lib/errors";
import { reminderJson, subscriptionJson, userJson } from "../../src/lib/serialize";

describe("errors", () => {
  it("serializam no formato { error }", () => {
    expect(validationError("x").toJSON()).toEqual({ error: { code: "validation_error", message: "x" } });
    expect(notFound().status).toBe(404);
    expect(unauthorized().status).toBe(401);
    const e = planLimit("plants", "free", "limite");
    expect(e).toBeInstanceOf(ApiError);
    expect(e.status).toBe(403);
    expect(e.toJSON()).toEqual({ error: { code: "plan_limit", message: "limite", feature: "plants", plan: "free" } });
  });
});

describe("serialize", () => {
  it("userJson converte snake_case e booleano", () => {
    const json = userJson({
      id: "usr_1",
      name: "Ana",
      email: "a@b.co",
      display_name: null,
      has_completed_onboarding: 1,
      password_hash: "h",
      password_salt: "s",
      password_iterations: 1,
      tz_offset: 0,
      created_at: "2026-01-01T00:00:00.000Z",
    });
    expect(json).toEqual({
      id: "usr_1",
      name: "Ana",
      email: "a@b.co",
      displayName: null,
      hasCompletedOnboarding: true,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(json).not.toHaveProperty("password_hash");
  });

  it("subscriptionJson e reminderJson", () => {
    expect(subscriptionJson({ user_id: "u", plan: "pro", started_at: "a", renews_at: null })).toEqual({
      plan: "pro",
      startedAt: "a",
      renewsAt: null,
    });
    expect(
      reminderJson({
        id: "r",
        user_id: "u",
        plant_id: "p",
        interval_days: 3,
        hour: 8,
        minute: 30,
        last_watered_at: null,
        created_at: "c",
      }),
    ).toEqual({ id: "r", plantId: "p", intervalDays: 3, hour: 8, minute: 30, lastWateredAt: null, createdAt: "c" });
  });
});
