import { describe, expect, it } from "vitest";
import { api } from "../helpers";

describe("app", () => {
  it("GET / responde status da API", async () => {
    const res = await api("GET", "/");
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ name: "FlorAI API", status: "running" });
  });

  it("rota inexistente retorna 404 not_found", async () => {
    const res = await api("GET", "/nao-existe");
    expect(res.status).toBe(404);
    expect(res.json.error.code).toBe("not_found");
  });

  it("CORS responde preflight com os headers permitidos", async () => {
    const res = await api("OPTIONS", "/auth/login", {
      headers: { Origin: "https://app.florai.cc", "Access-Control-Request-Method": "POST" },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Access-Control-Allow-Headers")).toContain("X-Timezone-Offset");
    expect(res.headers.get("Access-Control-Max-Age")).toBe("86400");
  });

  it("GET /health verifica D1 e R2", async () => {
    const res = await api("GET", "/health");
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ status: "ok", database: "connected", storage: "connected" });
  });

  it.each(["/me", "/identifications", "/collections", "/plants", "/subscription", "/usage/today", "/reminders"])(
    "%s exige autenticação",
    async (path) => {
      const res = await api("GET", path);
      expect(res.status).toBe(401);
      expect(res.json.error.code).toBe("unauthorized");
    },
  );
});
