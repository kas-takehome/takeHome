import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { openDatabase, type DB } from "./database";
import { createApp } from "./app";
import { HOUR, urgency, type Dispute } from "../shared/domain";

let db: DB;
beforeEach(() => {
  db = openDatabase(":memory:");
});
afterEach(() => db.close());
describe("queue and seed", () => {
  it("seeds 48 varied synthetic disputes and is idempotent on an existing database", async () => {
    const response = await request(createApp(db))
      .get("/api/disputes")
      .expect(200);
    const rows = response.body.disputes as Dispute[];
    expect(rows).toHaveLength(48);
    expect(new Set(rows.map((row) => row.status)).size).toBe(7);
    expect(new Set(rows.map((row) => urgency(row.network_deadline))).size).toBe(
      4,
    );
    expect(
      rows.every((row) => row.amount >= 1500 && row.amount <= 300000),
    ).toBe(true);
    expect(rows.map((row) => row.network_deadline)).toEqual(
      rows.map((row) => row.network_deadline).sort(),
    );
  });
  it("combines filters and searches literally without SQL interpolation", async () => {
    const app = createApp(db);
    const response = await request(app)
      .get("/api/disputes")
      .query({
        status: "new",
        reason: "fraud",
        search: "Olivia",
        agent: "unassigned",
      })
      .expect(200);
    expect(response.body.total).toBe(1);
    for (const search of ["' OR 1=1 --", "%", "_"]) {
      const result = await request(app)
        .get("/api/disputes")
        .query({ search })
        .expect(200);
      if (search !== "_") expect(result.body.total).toBe(0);
    }
    await request(app)
      .get("/api/disputes")
      .query({ sort: "amount; DROP TABLE disputes" })
      .expect(400);
    await request(app)
      .get("/api/disputes")
      .query({ status: "invalid" })
      .expect(400);
  });
  it("sorts amounts and filters urgency", async () => {
    const response = await request(createApp(db))
      .get("/api/disputes")
      .query({ sort: "amount", order: "desc", urgency: "urgent" })
      .expect(200);
    const rows = response.body.disputes as Dispute[];
    expect(rows.length).toBeGreaterThan(0);
    expect(
      rows.every((row) => urgency(row.network_deadline) === "urgent"),
    ).toBe(true);
    expect(rows.map((row) => row.amount)).toEqual(
      rows.map((row) => row.amount).sort((a, b) => b - a),
    );
  });
  it("disables caching and sends protective response headers", async () => {
    const response = await request(createApp(db))
      .get("/api/disputes")
      .expect(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-powered-by"]).toBeUndefined();
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
describe("SLA boundary rules", () => {
  it("handles overdue, exactly 48 hours, and exactly 5 days", () => {
    const now = Date.now();
    const level = (hours: number) =>
      urgency(new Date(now + hours * HOUR).toISOString(), now);
    expect(level(-1)).toBe("overdue");
    expect(level(0)).toBe("urgent");
    expect(level(47.99)).toBe("urgent");
    expect(level(48)).toBe("upcoming");
    expect(level(120)).toBe("upcoming");
    expect(level(120.01)).toBe("on_track");
  });
});
