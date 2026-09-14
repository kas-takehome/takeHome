import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import request from "supertest";
import { createApp } from "./app";
import {
  createAuthentication,
  hashPassword,
  readAuthConfig,
  type AuthConfig,
} from "./auth";
import { openDatabase, type DB } from "./database";

const password = "local-test-password-only";
const headers = { "X-Dispute-Client": "internal-web" };
let config: AuthConfig;
let db: DB;
beforeAll(async () => {
  config = {
    username: "admin",
    passwordHash: await hashPassword(password),
    secureCookies: false,
  };
});
beforeEach(() => {
  db = openDatabase(":memory:");
});
afterEach(() => {
  db.close();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
const appFor = (settings = config) =>
  createApp(db, createAuthentication(db, settings));
async function login(
  app: ReturnType<typeof createApp>,
  credentials = { username: "admin", password },
) {
  return request(app).post("/api/auth/login").set(headers).send(credentials);
}
function sessionCookie(response: request.Response) {
  return cookieHeader(response).split(";")[0];
}
function cookieHeader(response: request.Response): string {
  const cookies: unknown = response.headers["set-cookie"];
  if (!Array.isArray(cookies) || typeof cookies[0] !== "string")
    throw new Error("Expected a session cookie.");
  return cookies[0];
}

describe("admin authentication", () => {
  it("fails closed without secrets or a production HTTPS origin", () => {
    vi.stubEnv("ADMIN_PASSWORD_HASH", "");
    expect(() => readAuthConfig()).toThrow("ADMIN_PASSWORD_HASH");
    vi.stubEnv("ADMIN_PASSWORD_HASH", config.passwordHash);
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("APP_ORIGIN", "");
    expect(() => readAuthConfig()).toThrow("HTTPS");
    vi.stubEnv("APP_ORIGIN", "https://triage.example");
    expect(readAuthConfig().secureCookies).toBe(true);
  });
  it("protects every data route from anonymous requests", async () => {
    const app = appFor();
    for (const path of [
      "/customers",
      "/disputes",
      "/disputes/DSP-1048",
      "/summary",
      "/auth/session",
    ])
      await request(app).get(`/api${path}`).expect(401);
    for (const path of [
      "/disputes",
      "/disputes/DSP-1048/notes",
      "/disputes/bulk-status",
    ])
      await request(app).post(`/api${path}`).set(headers).send({}).expect(401);
    await request(app)
      .patch("/api/disputes/DSP-1048")
      .set(headers)
      .send({})
      .expect(401);
    await request(app).get("/api/health").expect(200);
  });
  it("uses identical errors for invalid passwords and usernames", async () => {
    const app = appFor();
    const wrongPassword = await login(app, {
      username: "admin",
      password: "wrong-password",
    });
    const wrongUser = await login(app, { username: "other", password });
    expect(wrongPassword.status).toBe(401);
    expect(wrongUser.status).toBe(401);
    expect(wrongPassword.body).toEqual(wrongUser.body);
    expect(wrongPassword.headers["set-cookie"]).toBeUndefined();
    expect(db.prepare("SELECT COUNT(*) AS n FROM auth_sessions").get()).toEqual(
      { n: 0 },
    );
  });
  it("sets protected cookies, stores only token hashes, and derives audit actors from the session", async () => {
    const app = appFor({ ...config, secureCookies: true });
    const response = await login(app);
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    const cookie = cookieHeader(response);
    expect(cookie).toMatch(/^__Host-dispute-session=/);
    for (const attribute of [
      "HttpOnly",
      "Secure",
      "SameSite=Strict",
      "Path=/",
      "Max-Age=28800",
    ])
      expect(cookie).toContain(attribute);
    expect(cookie).not.toContain("Domain=");
    const rawToken = sessionCookie(response).split("=")[1];
    const stored = db.prepare("SELECT * FROM auth_sessions").get();
    expect(JSON.stringify(stored)).not.toContain(rawToken);
    expect(JSON.stringify(stored)).not.toContain(password);
    const session = sessionCookie(response);
    await request(app).get("/api/customers").set("Cookie", session).expect(200);
    const note = await request(app)
      .post("/api/disputes/DSP-1048/notes")
      .set(headers)
      .set("Cookie", session)
      .send({ note: "Authentication verified." })
      .expect(201);
    expect(note.body.events[0].actor).toBe("admin");
  });
  it("revokes sessions on logout, expiry, password rotation, and successful reauthentication", async () => {
    const app = appFor();
    const first = sessionCookie(await login(app));
    const secondResponse = await request(app)
      .post("/api/auth/login")
      .set(headers)
      .set("Cookie", first)
      .send({ username: "admin", password })
      .expect(200);
    const second = sessionCookie(secondResponse);
    expect(second).not.toBe(first);
    await request(app)
      .get("/api/auth/session")
      .set("Cookie", first)
      .expect(401);
    await request(app)
      .get("/api/auth/session")
      .set("Cookie", second)
      .expect(200);
    await request(app)
      .post("/api/auth/logout")
      .set(headers)
      .set("Cookie", second)
      .send({})
      .expect(200);
    await request(app).get("/api/customers").set("Cookie", second).expect(401);
    const expired = sessionCookie(await login(app));
    db.prepare("UPDATE auth_sessions SET expires_at = ?").run(Date.now() - 1);
    await request(app).get("/api/disputes").set("Cookie", expired).expect(401);
    const rotated = sessionCookie(await login(app));
    const nextApp = appFor({
      ...config,
      passwordHash: await hashPassword("different-test-password"),
    });
    await request(nextApp)
      .get("/api/auth/session")
      .set("Cookie", rotated)
      .expect(401);
  });
  it("rejects forged and duplicate cookies", async () => {
    const app = appFor();
    const cookie = sessionCookie(await login(app));
    for (const forged of [
      `${cookie}x`,
      "dispute-session=not-a-token",
      `${cookie}; ${cookie}`,
    ])
      await request(app)
        .get("/api/customers")
        .set("Cookie", forged)
        .expect(401);
  });
  it("guards login and logout against cross-site and wrong-origin requests", async () => {
    vi.stubEnv("APP_ORIGIN", "https://triage.example");
    const app = appFor();
    for (const path of ["/login", "/logout"]) {
      const endpoint = `/api/auth${path}`;
      await request(app)
        .post(endpoint)
        .set("Host", "triage.example")
        .send({})
        .expect(403);
      await request(app)
        .post(endpoint)
        .set("Host", "triage.example")
        .set(headers)
        .set("Origin", "https://attacker.example")
        .send({})
        .expect(403);
      await request(app)
        .post(endpoint)
        .set("Host", "triage.example")
        .set(headers)
        .set("Origin", "https://triage.example")
        .set("Sec-Fetch-Site", "cross-site")
        .send({})
        .expect(403);
    }
    await request(app)
      .post("/api/auth/login")
      .set("Host", "triage.example")
      .set(headers)
      .set("Origin", "https://triage.example")
      .send({ username: "admin", password })
      .expect(200);
  });
  it("shares login limits across app instances and releases them after the window", async () => {
    const app = appFor();
    const other = appFor();
    for (let i = 0; i < 10; i++)
      expect(
        (
          await login(i % 2 ? app : other, {
            username: "admin",
            password: "wrong",
          })
        ).status,
      ).toBe(401);
    expect((await login(other)).status).toBe(429);
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 15 * 60 * 1000 + 1);
    expect((await login(other)).status).toBe(200);
  });
  it("rejects unexpected fields and oversized input without creating a session", async () => {
    const app = appFor();
    await request(app)
      .post("/api/auth/login")
      .set(headers)
      .send({ username: "admin", password, role: "admin" })
      .expect(400);
    await request(app)
      .post("/api/auth/login")
      .set(headers)
      .send({ username: "admin", password: "x".repeat(257) })
      .expect(400);
    expect(db.prepare("SELECT COUNT(*) AS n FROM auth_sessions").get()).toEqual(
      { n: 0 },
    );
  });
});
