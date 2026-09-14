import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { Router, type Request } from "express";
import { z } from "zod";
import type { DB } from "./database";
import { protectMutation, type Actor } from "./security";

const scryptOptions = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
function deriveKey(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, scryptOptions, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}
const passwordPattern = /^scrypt:([a-f0-9]{32}):([a-f0-9]{128})$/;
const SESSION_MS = 8 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const loginInput = z
  .object({
    username: z.string().min(1).max(80),
    password: z.string().min(1).max(256),
  })
  .strict();

export interface AuthConfig {
  username: string;
  passwordHash: string;
  secureCookies: boolean;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const key = await deriveKey(password, salt);
  return `scrypt:${salt}:${key.toString("hex")}`;
}

export function readAuthConfig(): AuthConfig {
  const username = process.env.ADMIN_USERNAME || "admin";
  const passwordHash = process.env.ADMIN_PASSWORD_HASH || "";
  if (!passwordPattern.test(passwordHash))
    throw new Error(
      "Set ADMIN_PASSWORD_HASH to a generated scrypt hash before starting.",
    );
  const hosted =
    process.env.VERCEL === "1" || process.env.NODE_ENV === "production";
  const origin = process.env.APP_ORIGIN;
  if (hosted && (!origin || new URL(origin).protocol !== "https:"))
    throw new Error("Production requires an HTTPS APP_ORIGIN.");
  if (origin && new URL(origin).origin !== origin)
    throw new Error(
      "APP_ORIGIN must be an exact origin without a trailing slash.",
    );
  return {
    username,
    passwordHash,
    secureCookies: origin?.startsWith("https://") ?? false,
  };
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function createAuthentication(db: DB, config: AuthConfig) {
  const match = passwordPattern.exec(config.passwordHash);
  if (!match) throw new Error("Invalid password hash configuration.");
  const salt = match[1];
  const expectedKey = Buffer.from(match[2], "hex");
  const credentialVersion = digest(`${config.username}:${config.passwordHash}`);
  const cookieName = config.secureCookies
    ? "__Host-dispute-session"
    : "dispute-session";
  const cookieOptions = {
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: "strict" as const,
    path: "/",
  };
  const actor: Actor = {
    id: config.username,
    name: config.username,
    permissions: ["disputes:read", "disputes:write"],
  };
  db.exec(`
    CREATE TABLE IF NOT EXISTS auth_sessions (
      token_hash TEXT PRIMARY KEY,
      credential_version TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS auth_sessions_expiry_idx ON auth_sessions(expires_at);
    CREATE TABLE IF NOT EXISTS auth_login_limits (
      bucket TEXT PRIMARY KEY,
      attempts INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
  `);
  function tokenHash(req: Request): string | null {
    const cookies = (req.get("Cookie") || "")
      .split(";")
      .map((part) => part.trim());
    const values = cookies.filter((part) => part.startsWith(`${cookieName}=`));
    if (values.length !== 1) return null;
    const token = values[0].slice(cookieName.length + 1);
    return /^[a-f0-9]{64}$/.test(token) ? digest(token) : null;
  }
  function validSession(req: Request): boolean {
    const hash = tokenHash(req);
    return (
      !!hash &&
      !!db
        .prepare(
          "SELECT 1 FROM auth_sessions WHERE token_hash = ? AND credential_version = ? AND expires_at > ?",
        )
        .get(hash, credentialVersion, Date.now())
    );
  }
  function allowLogin(req: Request): boolean {
    const now = Date.now();
    return db
      .transaction(() => {
        db.prepare("DELETE FROM auth_login_limits WHERE expires_at <= ?").run(
          now,
        );
        db.prepare(
          "DELETE FROM auth_sessions WHERE expires_at <= ? OR credential_version != ?",
        ).run(now, credentialVersion);
        const buckets = [
          { key: `ip:${digest(req.ip || "unknown")}`, limit: 10 },
          { key: "global", limit: 100 },
        ];
        for (const { key, limit } of buckets) {
          const row = db
            .prepare("SELECT attempts FROM auth_login_limits WHERE bucket = ?")
            .get(key) as { attempts: number } | undefined;
          if (row && row.attempts >= limit) return false;
        }
        for (const { key } of buckets)
          db.prepare(
            `INSERT INTO auth_login_limits VALUES (?, 1, ?)
          ON CONFLICT(bucket) DO UPDATE SET attempts = attempts + 1`,
          ).run(key, now + LOGIN_WINDOW_MS);
        return true;
      })
      .immediate();
  }

  const router = Router();
  router.post("/auth/login", protectMutation, async (req, res) => {
    if (!allowLogin(req)) {
      res.set("Retry-After", String(LOGIN_WINDOW_MS / 1000));
      res
        .status(429)
        .json({ error: "Too many sign-in attempts. Try again in 15 minutes." });
      return;
    }
    const input = loginInput.parse(req.body);
    const actualKey = await deriveKey(input.password, salt);
    const passwordMatches = timingSafeEqual(actualKey, expectedKey);
    if (!passwordMatches || input.username !== config.username) {
      res.status(401).json({ error: "Invalid username or password." });
      return;
    }
    const token = randomBytes(32).toString("hex");
    db.transaction(() => {
      const previous = tokenHash(req);
      if (previous)
        db.prepare("DELETE FROM auth_sessions WHERE token_hash = ?").run(
          previous,
        );
      db.prepare("INSERT INTO auth_sessions VALUES (?, ?, ?)").run(
        digest(token),
        credentialVersion,
        Date.now() + SESSION_MS,
      );
    }).immediate();
    res.cookie(cookieName, token, { ...cookieOptions, maxAge: SESSION_MS });
    res.json({ user: { username: config.username } });
  });
  router.get("/auth/session", (req, res) => {
    if (!validSession(req)) {
      res.clearCookie(cookieName, cookieOptions);
      res.status(401).json({ error: "Sign in to continue." });
      return;
    }
    res.json({ user: { username: config.username } });
  });
  router.post("/auth/logout", protectMutation, (req, res) => {
    const hash = tokenHash(req);
    if (hash)
      db.prepare("DELETE FROM auth_sessions WHERE token_hash = ?").run(hash);
    res.clearCookie(cookieName, cookieOptions);
    res.json({ ok: true });
  });
  router.use((req, res, next) => {
    if (req.path === "/health") {
      next();
      return;
    }
    if (!validSession(req)) {
      res.status(401).json({ error: "Sign in to continue." });
      return;
    }
    res.locals.actor = actor;
    next();
  });
  return router;
}
