import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { openDatabase, type DB } from "./database";
import { createApp } from "./app";
import { getDispute, getSummary } from "./disputes";
import { HOUR, isActive, type Dispute } from "../shared/domain";

let db: DB;
beforeEach(() => {
  db = openDatabase(":memory:");
});
afterEach(() => db.close());
describe("summary", () => {
  it("counts all statuses, active upcoming breaches, overdue, and non-closed amounts", async () => {
    const now = Date.now();
    const rows = db.prepare("SELECT * FROM disputes").all() as Dispute[];
    const summary = getSummary(db, now);
    expect(Object.values(summary.by_status).reduce((a, b) => a + b, 0)).toBe(
      48,
    );
    expect(summary.due_48h).toBe(
      rows.filter(
        (row) =>
          isActive(row.status) &&
          Date.parse(row.network_deadline) >= now &&
          Date.parse(row.network_deadline) < now + 48 * HOUR,
      ).length,
    );
    expect(summary.overdue).toBe(
      rows.filter(
        (row) => isActive(row.status) && Date.parse(row.network_deadline) < now,
      ).length,
    );
    expect(summary.amount_at_risk.USD).toBe(
      rows
        .filter((row) => row.status !== "closed")
        .reduce((sum, row) => sum + row.amount, 0),
    );
    const filtered = await request(createApp(db))
      .get("/api/disputes?urgency=urgent&scope=active")
      .expect(200);
    expect(filtered.body.total).toBe(summary.due_48h);
  });
  it("updates metrics after mutations and keeps currencies separate", async () => {
    const app = createApp(db);
    const dispute = getDispute(db, "DSP-1048");
    const before = getSummary(db);
    await request(app)
      .patch(`/api/disputes/${dispute.id}`)
      .set("X-Dispute-Client", "internal-web")
      .send({ status: "closed", expected_updated_at: dispute.updated_at })
      .expect(200);
    const response = await request(app).get("/api/summary").expect(200);
    expect(response.body.by_status.closed).toBe(before.by_status.closed + 1);
    expect(response.body.amount_at_risk.USD).toBe(
      before.amount_at_risk.USD - dispute.amount,
    );
    db.prepare(
      "UPDATE disputes SET currency = 'EUR' WHERE id = 'DSP-1047'",
    ).run();
    expect(getSummary(db).amount_at_risk.EUR).toBe(
      getDispute(db, "DSP-1047").amount,
    );
  });
});
