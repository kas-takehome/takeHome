import Database from "libsql";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initializeDatabase, type DB } from "./database";
import { adaptLibsql } from "./hosted-database";
import {
  appendNote,
  bulkStatus,
  createDispute,
  getDetail,
  getSummary,
} from "./disputes";

let db: DB;
beforeEach(() => {
  db = adaptLibsql(new Database(":memory:"));
  db.pragma("foreign_keys = ON");
  initializeDatabase(db);
});
afterEach(() => db.close());

describe("libSQL driver compatibility", () => {
  it("initializes idempotently and preserves the existing dataset", () => {
    const before = getDetail(db, "DSP-1048");
    initializeDatabase(db);
    expect(getSummary(db).total).toBe(48);
    expect(getDetail(db, "DSP-1048")).toEqual(before);
    expect(db.pragma("foreign_key_check")).toEqual([]);
  });
  it("allocates transaction IDs and appends immutable audit events", () => {
    const result = createDispute(db, "admin", {
      customer_id: 1,
      amount: 1500,
      currency: "USD",
      reason_code: "fraud",
      assigned_agent: null,
      notes: "",
    });
    expect(result.dispute.transaction_id).toBe(49);
    expect(
      appendNote(db, result.dispute.id, "admin", "Reviewed").events[0].actor,
    ).toBe("admin");
    expect(() => db.prepare("DELETE FROM dispute_events").run()).toThrow(
      "cannot be deleted",
    );
  });
  it("commits bulk updates atomically without nested driver transactions", () => {
    const items = ["DSP-1048", "DSP-1047"].map((id) => ({
      id,
      expected_updated_at: getDetail(db, id).dispute.updated_at,
    }));
    expect(bulkStatus(db, "admin", items, "closed").updated).toBe(2);
    for (const item of items)
      expect(getDetail(db, item.id).dispute.status).toBe("closed");
  });
  it("rolls back the whole bulk operation on stale records", () => {
    const before = getDetail(db, "DSP-1048");
    expect(() =>
      bulkStatus(
        db,
        "admin",
        [
          { id: "DSP-1048", expected_updated_at: before.dispute.updated_at },
          { id: "DSP-1047", expected_updated_at: "stale" },
        ],
        "closed",
      ),
    ).toThrow("changed");
    expect(getDetail(db, "DSP-1048")).toEqual(before);
  });
});
