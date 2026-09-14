import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "./app";
import { openDatabase, type DB } from "./database";
import { getDispute, getSummary } from "./disputes";
import type {
  CreateDisputeInput,
  DisputeDetail,
  QueueResponse,
} from "../shared/domain";
import type { Actor } from "./security";

let db: DB;
beforeEach(() => {
  db = openDatabase(":memory:");
});
afterEach(() => db.close());
const client = { "X-Dispute-Client": "internal-web" };
const input: CreateDisputeInput = {
  transaction_id: "txn_creation_test",
  customer_id: "cus_creation_test",
  customer_name: "Taylor Example",
  amount: 12345,
  currency: "USD",
  reason_code: "duplicate",
  date_received: new Date(Date.now() - 3600000).toISOString(),
  network_deadline: new Date(Date.now() + 86400000).toISOString(),
  assigned_agent: "Sarah Chen",
  notes: "<b>Synthetic dispute context</b>",
};

describe("dispute creation", () => {
  it("creates a new case with server-owned fields, audit history and updated queue/totals", async () => {
    const app = createApp(db);
    const before = getSummary(db);
    const response = await request(app)
      .post("/api/disputes")
      .set(client)
      .send(input)
      .expect(201);
    const { dispute, events } = response.body as DisputeDetail;
    expect(response.headers.location).toBe(`/api/disputes/${dispute.id}`);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(dispute).toMatchObject({ ...input, status: "new" });
    expect(dispute.id).toMatch(/^DSP-\d{1,12}$/);
    expect(dispute.created_at).toBe(dispute.updated_at);
    expect(dispute.risk_score).toBeGreaterThanOrEqual(0);
    expect(dispute.risk_score).toBeLessThanOrEqual(100);
    expect(events).toHaveLength(3);
    expect(events.every((event) => event.actor === "Local operator")).toBe(
      true,
    );
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event_type: "status_change",
          detail: "Dispute created with status New",
        }),
        expect.objectContaining({
          event_type: "assigned",
          detail: "Assigned to Sarah Chen",
        }),
        expect.objectContaining({
          event_type: "note_added",
          detail: input.notes,
        }),
      ]),
    );
    const queue = await request(app)
      .get("/api/disputes")
      .query({ search: input.transaction_id })
      .expect(200);
    expect((queue.body as QueueResponse).disputes).toEqual([dispute]);
    const detail = await request(app)
      .get(`/api/disputes/${dispute.id}`)
      .expect(200);
    expect((detail.body as DisputeDetail).dispute).toEqual(dispute);
    const after = getSummary(db);
    expect(after.total).toBe(before.total + 1);
    expect(after.by_status.new).toBe(before.by_status.new + 1);
    expect(after.due_48h).toBe(before.due_48h + 1);
    expect(after.amount_at_risk.USD).toBe(
      before.amount_at_risk.USD + input.amount,
    );
  });

  it("defaults optional fields, accepts overdue cases and normalizes timezone offsets", async () => {
    const app = createApp(db);
    const response = await request(app)
      .post("/api/disputes")
      .set(client)
      .send({
        ...input,
        date_received: "2025-02-10T10:00:00+02:00",
        network_deadline: "2025-02-11T10:00:00+02:00",
        assigned_agent: undefined,
        notes: undefined,
        currency: "EUR",
      })
      .expect(201);
    const data = response.body as DisputeDetail;
    expect(data.dispute.assigned_agent).toBeNull();
    expect(data.dispute.notes).toBe("");
    expect(data.dispute.date_received).toBe("2025-02-10T08:00:00.000Z");
    expect(data.dispute.network_deadline).toBe("2025-02-11T08:00:00.000Z");
    expect(data.events).toHaveLength(1);
    expect(getSummary(db).amount_at_risk.EUR).toBe(input.amount);
    const second = await request(app)
      .post("/api/disputes")
      .set(client)
      .send({
        ...input,
        transaction_id: "txn_next_creation",
      })
      .expect(201);
    expect((second.body as DisputeDetail).dispute.id).not.toBe(data.dispute.id);
  });

  it("rejects duplicate transactions without adding another record or audit event", async () => {
    const app = createApp(db);
    const existing = getDispute(db, "DSP-1048");
    const before = getSummary(db);
    const events = db
      .prepare("SELECT COUNT(*) AS count FROM dispute_events")
      .get();
    const response = await request(app)
      .post("/api/disputes")
      .set(client)
      .send({
        ...input,
        transaction_id: existing.transaction_id,
      })
      .expect(409);
    expect(response.body.error).toContain("already exists");
    expect(getSummary(db).total).toBe(before.total);
    expect(getDispute(db, existing.id)).toEqual(existing);
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM dispute_events").get(),
    ).toEqual(events);
  });

  it("accepts existing custom agents but rejects arbitrary new assignments", async () => {
    db.prepare("UPDATE disputes SET assigned_agent = ? WHERE id = ?").run(
      "Avery Jones",
      "DSP-1048",
    );
    const app = createApp(db);
    await request(app)
      .post("/api/disputes")
      .set(client)
      .send({
        ...input,
        assigned_agent: "Unknown agent",
      })
      .expect(400);
    const response = await request(app)
      .post("/api/disputes")
      .set(client)
      .send({
        ...input,
        assigned_agent: "Avery Jones",
      })
      .expect(201);
    expect((response.body as DisputeDetail).dispute.assigned_agent).toBe(
      "Avery Jones",
    );
    expect(getSummary(db).total).toBe(49);
  });

  it.each([
    { customer_name: " " },
    { customer_id: "" },
    { transaction_id: "txn invalid identifier" },
    { amount: 0 },
    { amount: -1 },
    { amount: 12.345 },
    { amount: "12.34" },
    { amount: 1000000000 },
    { currency: "INVALID" },
    { reason_code: "invalid" },
    { date_received: "not-a-date" },
    { network_deadline: "2025-02-30T00:00:00Z" },
    {
      date_received: "2026-01-02T00:00:00Z",
      network_deadline: "2026-01-01T00:00:00Z",
    },
    { customer_name: "Card 4242 4242 4242 4242" },
    { notes: "CVV: 123" },
    { notes: "ID 123-45-6789" },
    { notes: "x".repeat(4001) },
    { id: "DSP-1" },
    { actor: "Forged actor" },
    { risk_score: 0 },
    { status: "won" },
    { created_at: "2025-01-01T00:00:00Z" },
  ])(
    "rejects invalid or server-owned input %# without mutation",
    async (change) => {
      const before = getSummary(db);
      await request(createApp(db))
        .post("/api/disputes")
        .set(client)
        .send({ ...input, ...change })
        .expect(400);
      expect(getSummary(db).total).toBe(before.total);
    },
  );

  it("enforces permissions, trusted write headers and cross-site guards", async () => {
    const app = createApp(db);
    await request(app).post("/api/disputes").send(input).expect(403);
    await request(app)
      .post("/api/disputes")
      .set(client)
      .set("Sec-Fetch-Site", "cross-site")
      .send(input)
      .expect(403);
    const reader: Actor = {
      id: "reader",
      name: "Reader",
      permissions: ["disputes:read"],
    };
    const readOnly = createApp(db, (_req, res, next) => {
      res.locals.actor = reader;
      next();
    });
    await request(readOnly)
      .post("/api/disputes")
      .set(client)
      .send(input)
      .expect(403);
    expect(getSummary(db).total).toBe(48);
  });

  it("rolls back creation if writing the audit event fails", async () => {
    db.exec(
      "CREATE TRIGGER fail_creation_event BEFORE INSERT ON dispute_events BEGIN SELECT RAISE(ABORT, 'Simulated failure'); END",
    );
    const response = await request(createApp(db))
      .post("/api/disputes")
      .set(client)
      .send(input)
      .expect(500);
    expect(response.text).not.toContain("Simulated failure");
    expect(getSummary(db).total).toBe(48);
    expect(
      db
        .prepare("SELECT 1 FROM disputes WHERE transaction_id = ?")
        .get(input.transaction_id),
    ).toBeUndefined();
  });
});
