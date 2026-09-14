import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { openDatabase, type DB } from "./database";
import { createApp } from "./app";
import { getDispute } from "./disputes";
import type { Actor } from "./security";

let db: DB;
beforeEach(() => {
  db = openDatabase(":memory:");
});
afterEach(() => db.close());
const client = { "X-Dispute-Client": "internal-web" };
describe("security boundary review", () => {
  it("rejects unexpected hosts and honors read-only roles at every write route", async () => {
    const readOnly: Actor = {
      id: "reader",
      name: "Read-only operator",
      permissions: ["disputes:read"],
    };
    const app = createApp(db, (_req, res, next) => {
      res.locals.actor = readOnly;
      next();
    });
    await request(app).get("/api/disputes").expect(200);
    await request(app)
      .get("/api/disputes")
      .set("Host", "unexpected.example")
      .expect(403);
    await request(app)
      .patch("/api/disputes/DSP-1048")
      .set(client)
      .send({})
      .expect(403);
    await request(app)
      .post("/api/disputes/DSP-1048/notes")
      .set(client)
      .send({ note: "hello" })
      .expect(403);
    await request(app)
      .post("/api/disputes/bulk-status")
      .set(client)
      .send({})
      .expect(403);
  });
  it("protects all read routes when no identity permissions are present", async () => {
    const app = createApp(db, (_req, _res, next) => next());
    for (const path of [
      "/api/disputes",
      "/api/disputes/DSP-1048",
      "/api/summary",
    ])
      await request(app).get(path).expect(403);
  });
  it("limits body sizes, safely handles bad JSON, and rejects form submissions", async () => {
    const app = createApp(db);
    await request(app)
      .post("/api/disputes/DSP-1048/notes")
      .set(client)
      .send({ note: "a".repeat(20000) })
      .expect(413);
    await request(app)
      .post("/api/disputes/DSP-1048/notes")
      .set(client)
      .set("Content-Type", "application/json")
      .send("{")
      .expect(400);
    await request(app)
      .post("/api/disputes/DSP-1048/notes")
      .type("form")
      .send({ note: "hello" })
      .expect(403);
  });
  it("rate limits writes without changing state after the limit", async () => {
    const app = createApp(db);
    const before = getDispute(db, "DSP-1048");
    const body = {
      status: before.status,
      expected_updated_at: before.updated_at,
    };
    for (let i = 0; i < 60; i++)
      await request(app)
        .patch("/api/disputes/DSP-1048")
        .set(client)
        .send(body)
        .expect(200);
    await request(app)
      .patch("/api/disputes/DSP-1048")
      .set(client)
      .send(body)
      .expect(429);
    expect(getDispute(db, "DSP-1048")).toEqual(before);
  });
});
