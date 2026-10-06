import { describe, expect, it } from "vitest";
import {
  bytesToBase64,
  hashPassword,
  newId,
  newToken,
  PBKDF2_ITERATIONS,
  sha256Hex,
  verifyPassword,
} from "../../src/lib/crypto";

describe("crypto", () => {
  it("newId gera id com prefixo e 24 hex", () => {
    const id = newId("plt");
    expect(id).toMatch(/^plt_[0-9a-f]{24}$/);
    expect(newId("plt")).not.toBe(id);
  });

  it("newToken gera base64url de 32 bytes", () => {
    const token = newToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("sha256Hex é determinístico", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("hashPassword + verifyPassword", async () => {
    const stored = await hashPassword("minha-senha");
    expect(stored.iterations).toBe(PBKDF2_ITERATIONS);
    expect(stored.salt).toMatch(/^[0-9a-f]{32}$/);
    expect(stored.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await verifyPassword("minha-senha", stored)).toBe(true);
    expect(await verifyPassword("outra", stored)).toBe(false);
  });

  it("hashPassword usa salt aleatório", async () => {
    const [a, b] = await Promise.all([hashPassword("x"), hashPassword("x")]);
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
  });

  it("bytesToBase64 converte buffers grandes", () => {
    expect(bytesToBase64(new TextEncoder().encode("olá"))).toBe(btoa(String.fromCharCode(111, 108, 195, 161)));
    const big = new Uint8Array(100_000).fill(65);
    expect(atob(bytesToBase64(big)).length).toBe(100_000);
  });
});
