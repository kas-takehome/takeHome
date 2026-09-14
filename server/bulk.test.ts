import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { openDatabase, type DB } from "./database";
import { createApp } from "./app";
import { getDispute } from "./disputes";

let db: DB;
beforeEach(() => {
  db = openDatabase(":memory:");
});
afterEach(() => db.close());
const client = { "X-Dispute-Client": "internal-web" };
const snapshot = (id: string) => ({
  id,
  expected_updated_at: getDispute(db, id).updated_at,
});
describe("atomic bulk actions", () => {
  it("records one event per changed dispute and skips no-op transitions", async () => {
    const app = createApp(db);
    const disputes = ["DSP-1048", "DSP-1047", "DSP-1001"].map(snapshot);
    const response = await request(app)
      .post("/api/disputes/bulk-status")
      .set(client)
      .send({ disputes, status: "closed" })
      .expect(200);
    expect(response.body).toEqual({ updated: 2, unchanged: 1 });
    for (const id of ["DSP-1048", "DSP-1047"]) {
      expect(getDispute(db, id).status).toBe("closed");
      expect(
        db
          .prepare(
            "SELECT COUNT(*) AS count FROM dispute_events WHERE dispute_id = ? AND actor = 'Local operator'",
          )
          .get(id),
      ).toEqual({ count: 1 });
    }
  });
  it("rolls back all changes when any dispute is missing or stale", async () => {
    const app = createApp(db);
    const first = getDispute(db, "DSP-1048");
    for (const last of [
      { id: "DSP-9999", expected_updated_at: first.updated_at },
      { id: "DSP-1047", expected_updated_at: first.updated_at },
    ]) {
      const response = await request(app)
        .post("/api/disputes/bulk-status")
        .set(client)
        .send({ disputes: [snapshot(first.id), last], status: "closed" });
      expect([404, 409]).toContain(response.status);
      expect(getDispute(db, first.id)).toEqual(first);
      expect(
        db
          .prepare(
            "SELECT COUNT(*) AS count FROM dispute_events WHERE actor = 'Local operator'",
          )
          .get(),
      ).toEqual({ count: 0 });
    }
  });
  it("validates duplicate ids, empty selection, status, and batch size", async () => {
    const app = createApp(db);
    for (const disputes of [
      [],
      [snapshot("DSP-1048"), snapshot("DSP-1048")],
      Array.from({ length: 101 }, () => snapshot("DSP-1048")),
    ]) {
      await request(app)
        .post("/api/disputes/bulk-status")
        .set(client)
        .send({ disputes, status: "closed" })
        .expect(400);
    }
    await request(app)
      .post("/api/disputes/bulk-status")
      .set(client)
      .send({ disputes: [snapshot("DSP-1048")], status: "invalid" })
      .expect(400);
  });
});
