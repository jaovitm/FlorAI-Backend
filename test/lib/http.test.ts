import { afterEach, describe, expect, it, vi } from "vitest";
import { addDays, localDay, normalizeIso, parseTzOffset } from "../../src/lib/http";

describe("parseTzOffset", () => {
  it.each([
    ["-180", -180],
    [" 60 ", 60],
    ["0", 0],
    ["840", 840],
    ["-840", -840],
  ])("aceita %s", (input, expected) => expect(parseTzOffset(input)).toBe(expected));

  it.each([undefined, "abc", "1.5", "841", "-841"])("rejeita %s", (input) => {
    expect(parseTzOffset(input)).toBeUndefined();
  });

  it("header vazio vira 0 (Number(\"\") === 0)", () => expect(parseTzOffset("")).toBe(0));
});

describe("normalizeIso", () => {
  it("normaliza datas válidas para UTC", () => {
    expect(normalizeIso("2026-01-02T03:04:05-03:00")).toBe("2026-01-02T06:04:05.000Z");
  });
  it("retorna null para inválidas", () => {
    expect(normalizeIso("não é data")).toBeNull();
    expect(normalizeIso(123)).toBeNull();
    expect(normalizeIso(null)).toBeNull();
  });
});

describe("datas", () => {
  afterEach(() => vi.useRealTimers());

  it("addDays soma dias", () => {
    expect(addDays(new Date("2026-01-31T00:00:00Z"), 1).toISOString()).toBe("2026-02-01T00:00:00.000Z");
  });

  it("localDay aplica o offset do usuário", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-10T01:00:00Z"));
    expect(localDay(0)).toBe("2026-03-10");
    expect(localDay(-180)).toBe("2026-03-09");
    expect(localDay(60 * 23)).toBe("2026-03-11");
  });
});
