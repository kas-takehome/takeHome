import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { agents, type QueueResponse } from "../shared/domain";
import { createApp } from "./app";
import { openDatabase, type DB } from "./database";
import { getDispute } from "./disputes";

let db: DB;
beforeEach(() => {
  db = openDatabase(":memory:");
});
afterEach(() => db.close());

describe("agent filter options", () => {
  it("includes custom assignments globally, independently of queue filters", async () => {
    const app = createApp(db);
    for (const id of ["DSP-1048", "DSP-1047"]) {
      await request(app)
        .patch(`/api/disputes/${id}`)
        .set("X-Dispute-Client", "internal-web")
        .send({
          assigned_agent: "Avery Jones",
          expected_updated_at: getDispute(db, id).updated_at,
        })
        .expect(200);
    }
    const response = await request(app)
      .get("/api/disputes")
      .query({ agent: "Avery Jones", assignment: "assigned" })
      .expect(200);
    const body = response.body as QueueResponse;
    expect(body.disputes).toHaveLength(2);
    expect(
      body.disputes.every((row) => row.assigned_agent === "Avery Jones"),
    ).toBe(true);
    expect(body.agents).toEqual([...agents, "Avery Jones"]);
    const empty = await request(app)
      .get("/api/disputes")
      .query({ search: "Nobody matches this customer" })
      .expect(200);
    expect(empty.body.total).toBe(0);
    expect(empty.body.agents).toEqual(body.agents);
  });
  it("distinguishes an agent named unassigned from disputes with no agent", async () => {
    const app = createApp(db);
    await request(app)
      .patch("/api/disputes/DSP-1048")
      .set("X-Dispute-Client", "internal-web")
      .send({
        assigned_agent: "unassigned",
        expected_updated_at: getDispute(db, "DSP-1048").updated_at,
      })
      .expect(200);
    const named = await request(app)
      .get("/api/disputes")
      .query({ agent: "unassigned", assignment: "assigned" })
      .expect(200);
    expect(named.body.total).toBe(1);
    expect(named.body.disputes[0].id).toBe("DSP-1048");
    expect(named.body.agents).toContain("unassigned");
    const unassigned = await request(app)
      .get("/api/disputes")
      .query({ assignment: "unassigned" })
      .expect(200);
    const body = unassigned.body as QueueResponse;
    expect(body.total).toBeGreaterThan(0);
    expect(body.disputes.every((row) => row.assigned_agent === null)).toBe(
      true,
    );
    expect(body.disputes.some((row) => row.id === "DSP-1048")).toBe(false);
    await request(app)
      .get("/api/disputes")
      .query({ assignment: "unknown" })
      .expect(400);
  });
});
