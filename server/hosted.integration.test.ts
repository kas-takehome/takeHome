import Database from "libsql";
import request from "supertest";
import { expect, it } from "vitest";
import { adaptLibsql } from "./hosted-database";
import { initializeDatabase } from "./database";
import { createAuthentication, hashPassword } from "./auth";
import { createApp } from "./app";

it.skipIf(!process.env.LIBSQL_TEST_URL)(
  "shares authenticated sessions and durable mutations across remote connections",
  async () => {
    const url = process.env.LIBSQL_TEST_URL!;
    if (new URL(url).hostname !== "127.0.0.1")
      throw new Error(
        "Integration tests require a disposable loopback libSQL server.",
      );
    const first = adaptLibsql(new Database(url));
    const second = adaptLibsql(new Database(url));
    try {
      initializeDatabase(first);
      initializeDatabase(second);
      expect(second.pragma("user_version", { simple: true })).toBe(1);
      const config = {
        username: "admin",
        passwordHash: await hashPassword("remote-test-password"),
        secureCookies: false,
      };
      const app = createApp(first, createAuthentication(first, config));
      const otherApp = createApp(second, createAuthentication(second, config));
      const headers = { "X-Dispute-Client": "internal-web" };
      await request(app).get("/api/disputes").expect(401);
      const signIn = await request(app)
        .post("/api/auth/login")
        .set(headers)
        .send({ username: "admin", password: "remote-test-password" })
        .expect(200);
      const cookies: unknown = signIn.headers["set-cookie"];
      if (!Array.isArray(cookies) || typeof cookies[0] !== "string")
        throw new Error("Expected a session cookie.");
      const cookie = cookies[0].split(";")[0];
      await request(otherApp)
        .get("/api/auth/session")
        .set("Cookie", cookie)
        .expect(200);
      const created = await request(otherApp)
        .post("/api/disputes")
        .set(headers)
        .set("Cookie", cookie)
        .send({
          customer_id: 1,
          amount: 1500,
          currency: "USD",
          reason_code: "fraud",
          assigned_agent: null,
          notes: "",
        })
        .expect(201);
      const detail = await request(app)
        .get(`/api/disputes/${created.body.dispute.id}`)
        .set("Cookie", cookie)
        .expect(200);
      expect(detail.body.events[0].actor).toBe("admin");
      expect(detail.body.dispute).not.toHaveProperty("_metadata");
      const bulk = await request(app)
        .post("/api/disputes/bulk-status")
        .set(headers)
        .set("Cookie", cookie)
        .send({
          disputes: [
            {
              id: detail.body.dispute.id,
              expected_updated_at: detail.body.dispute.updated_at,
            },
          ],
          status: "closed",
        })
        .expect(200);
      expect(bulk.body.updated).toBe(1);
      await request(otherApp)
        .post("/api/auth/logout")
        .set(headers)
        .set("Cookie", cookie)
        .send({})
        .expect(200);
      await request(app).get("/api/disputes").set("Cookie", cookie).expect(401);
    } finally {
      first.close();
      second.close();
    }
  },
  60_000,
);
