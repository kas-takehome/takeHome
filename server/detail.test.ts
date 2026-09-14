import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { openDatabase, type DB } from "./database";
import { createApp } from "./app";
import { getDispute } from "./disputes";
import type { DisputeDetail } from "../shared/domain";

let db: DB;
beforeEach(() => {
  db = openDatabase(":memory:");
});
afterEach(() => db.close());
const client = { "X-Dispute-Client": "internal-web" };
describe("detail and audited mutations", () => {
  it("returns customer-linked mock signals, transaction history, and ordered events", async () => {
    const response = await request(createApp(db))
      .get("/api/disputes/DSP-1048")
      .expect(200);
    const data = response.body as DisputeDetail;
    expect(data.transactions.length).toBeGreaterThanOrEqual(2);
    expect(data.transactions.length).toBeLessThanOrEqual(4);
    expect(data.risk).toHaveLength(4);
    expect(data.events.map((event) => event.created_at)).toEqual(
      data.events
        .map((event) => event.created_at)
        .sort()
        .reverse(),
    );
    await request(createApp(db)).get("/api/disputes/DSP-9999").expect(404);
  });
  it("saves statuses and assignments with server-derived actors; rejects stale edits", async () => {
    const app = createApp(db);
    const before = getDispute(db, "DSP-1048");
    const response = await request(app)
      .patch("/api/disputes/DSP-1048")
      .set(client)
      .send({
        status: "evidence_submitted",
        assigned_agent: "Sarah Chen",
        expected_updated_at: before.updated_at,
      })
      .expect(200);
    const data = response.body as DisputeDetail;
    expect(data.dispute.status).toBe("evidence_submitted");
    expect(data.dispute.updated_at > before.updated_at).toBe(true);
    expect(
      data.events.filter((event) => event.actor === "Local operator"),
    ).toHaveLength(2);
    expect(
      data.events.some((event) => event.event_type === "evidence_submitted"),
    ).toBe(true);
    await request(app)
      .patch("/api/disputes/DSP-1048")
      .set(client)
      .send({ status: "closed", expected_updated_at: before.updated_at })
      .expect(409);
    expect(getDispute(db, "DSP-1048").status).toBe("evidence_submitted");
  });
  it("appends notes without losing prior notes and treats markup as plain text", async () => {
    const app = createApp(db);
    const before = getDispute(db, "DSP-1048");
    const note = "<b>Verified merchant documentation</b>";
    const response = await request(app)
      .post("/api/disputes/DSP-1048/notes")
      .set(client)
      .send({ note })
      .expect(201);
    const data = response.body as DisputeDetail;
    expect(data.dispute.notes).toBe(`${before.notes}\n\n${note}`);
    expect(data.events[0].detail).toBe(note);
    expect(data.events[0].event_type).toBe("note_added");
  });
  it("rejects invalid fields, mass assignment, untrusted browser writes, and sensitive identifiers", async () => {
    const app = createApp(db);
    const before = getDispute(db, "DSP-1048");
    await request(app)
      .patch("/api/disputes/DSP-1048")
      .send({ status: "closed" })
      .expect(403);
    await request(app)
      .patch("/api/disputes/DSP-1048")
      .set(client)
      .set("Sec-Fetch-Site", "cross-site")
      .send({ status: "closed" })
      .expect(403);
    await request(app)
      .patch("/api/disputes/DSP-1048")
      .set(client)
      .send({
        status: "closed",
        actor: "CEO",
        expected_updated_at: before.updated_at,
      })
      .expect(400);
    await request(app)
      .patch("/api/disputes/DSP-1048")
      .set(client)
      .send({ risk_score: 0, expected_updated_at: before.updated_at })
      .expect(400);
    for (const note of [
      "",
      " ".repeat(10),
      "x".repeat(4001),
      "Card 4242 4242 4242 4242",
      "CVV: 123",
      "ID 123-45-6789",
    ]) {
      await request(app)
        .post("/api/disputes/DSP-1048/notes")
        .set(client)
        .send({ note })
        .expect(400);
    }
    expect(getDispute(db, "DSP-1048")).toEqual(before);
  });
  it("prevents edits and deletion of audit events at the database layer", () => {
    expect(() =>
      db.prepare("UPDATE dispute_events SET actor = 'Forged'").run(),
    ).toThrow("Audit events cannot be changed");
    expect(() => db.prepare("DELETE FROM dispute_events").run()).toThrow(
      "Audit events cannot be deleted",
    );
  });
  it("rolls back the mutation if writing its audit event fails", async () => {
    const before = getDispute(db, "DSP-1048");
    db.exec(
      "CREATE TRIGGER fail_event BEFORE INSERT ON dispute_events BEGIN SELECT RAISE(ABORT, 'Simulated failure'); END",
    );
    const response = await request(createApp(db))
      .patch("/api/disputes/DSP-1048")
      .set(client)
      .send({ status: "closed", expected_updated_at: before.updated_at })
      .expect(500);
    expect(getDispute(db, "DSP-1048")).toEqual(before);
    expect(response.text).not.toContain("Simulated failure");
  });
});
