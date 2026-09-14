import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type DB } from "./database";
import { migrateDatabase } from "./migrations";
import type { Customer, Dispute, DisputeEvent } from "../shared/domain";

type LegacyDispute = Omit<Dispute, "customer_id" | "transaction_id"> & {
  customer_id: string;
  transaction_id: string;
};

const databases: DB[] = [];
const directories: string[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) if (db.open) db.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function legacyDatabase(filename = ":memory:") {
  const db = new Database(filename);
  databases.push(db);
  db.exec(`
    CREATE TABLE disputes (
      id TEXT PRIMARY KEY, transaction_id TEXT NOT NULL UNIQUE,
      customer_id TEXT NOT NULL, customer_name TEXT NOT NULL,
      amount INTEGER NOT NULL, currency TEXT NOT NULL, reason_code TEXT NOT NULL,
      status TEXT NOT NULL, date_received TEXT NOT NULL, network_deadline TEXT NOT NULL,
      assigned_agent TEXT, risk_score INTEGER NOT NULL, notes TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE dispute_events (
      id TEXT PRIMARY KEY, dispute_id TEXT NOT NULL REFERENCES disputes(id),
      event_type TEXT NOT NULL, actor TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL
    );
    INSERT INTO disputes VALUES
      ('DSP-1001', 'txn_a', 'cus_a', 'Taylor Example', 12345, 'USD', 'fraud', 'new',
       '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z', NULL, 30, 'First case',
       '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
      ('DSP-1002', 'txn_b', 'cus_a', 'Taylor Renamed', 67890, 'EUR', 'duplicate', 'investigating',
       '2026-01-03T00:00:00.000Z', '2026-01-04T00:00:00.000Z', 'Sarah Chen', 40, 'Second case',
       '2026-01-03T00:00:00.000Z', '2026-01-03T01:00:00.000Z'),
      ('DSP-1003', 'txn_c', 'cus_b', 'Taylor Example', 100, 'USD', 'other', 'closed',
       '2026-01-05T00:00:00.000Z', '2026-01-06T00:00:00.000Z', NULL, 50, '',
       '2026-01-05T00:00:00.000Z', '2026-01-05T00:00:00.000Z');
    INSERT INTO dispute_events VALUES
      ('event-1', 'DSP-1001', 'note_added', 'Local operator', 'First case', '2026-01-01T00:00:00.000Z'),
      ('event-2', 'DSP-1002', 'assigned', 'Local operator', 'Assigned to Sarah Chen', '2026-01-03T01:00:00.000Z');
  `);
  db.pragma("foreign_keys = ON");
  return db;
}

describe("customer and transaction migration", () => {
  it("seeds integer customer/transaction IDs with enforced customer references", () => {
    const db = openDatabase(":memory:");
    databases.push(db);
    const customers = db.prepare("SELECT * FROM customers").all() as Customer[];
    const disputes = db.prepare("SELECT * FROM disputes").all() as Dispute[];
    expect(customers).toHaveLength(48);
    expect(disputes).toHaveLength(48);
    for (const dispute of disputes) {
      expect(Number.isInteger(dispute.transaction_id)).toBe(true);
      expect(customers).toContainEqual({
        customer_id: dispute.customer_id,
        customer_name: dispute.customer_name,
      });
    }
    expect(() =>
      db.prepare("UPDATE disputes SET customer_id = 9999 WHERE id = ?").run("DSP-1048"),
    ).toThrow(/FOREIGN KEY/);
    expect(() =>
      db.prepare("UPDATE disputes SET transaction_id = ? WHERE id = ?").run(1, "DSP-1047"),
    ).toThrow(/UNIQUE/);
    expect(db.pragma("foreign_key_check")).toEqual([]);
  });

  it("preserves cases, snapshots and immutable audit history and migrates only once", () => {
    const db = legacyDatabase();
    const before = db.prepare("SELECT * FROM disputes ORDER BY id").all() as LegacyDispute[];
    const events = db.prepare("SELECT * FROM dispute_events ORDER BY id").all() as DisputeEvent[];
    migrateDatabase(db);
    const disputes = db.prepare("SELECT * FROM disputes ORDER BY id").all() as Dispute[];
    expect(disputes).toEqual(before.map((dispute, index) => ({
      ...dispute,
      transaction_id: index + 1,
      customer_id: index < 2 ? 1 : 2,
    })));
    const customers = db.prepare("SELECT * FROM customers ORDER BY customer_id").all();
    expect(customers).toEqual([
      { customer_id: 1, customer_name: "Taylor Example" },
      { customer_id: 2, customer_name: "Taylor Example" },
    ]);
    expect(db.prepare("SELECT * FROM dispute_events ORDER BY id").all()).toEqual(events);
    expect(() => db.exec("UPDATE dispute_events SET detail = 'changed'")).toThrow(/cannot be changed/);
    expect(() => db.exec("DELETE FROM dispute_events")).toThrow(/cannot be deleted/);
    expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(db.pragma("foreign_key_check")).toEqual([]);
    migrateDatabase(db);
    expect(db.prepare("SELECT * FROM disputes ORDER BY id").all()).toEqual(disputes);
    expect(db.prepare("SELECT * FROM customers ORDER BY customer_id").all()).toEqual(customers);
    expect(db.pragma("user_version", { simple: true })).toBe(1);
  });

  it("rolls back the entire migration when legacy audit references are invalid", () => {
    const db = legacyDatabase();
    db.pragma("foreign_keys = OFF");
    db.exec("INSERT INTO dispute_events VALUES ('orphan', 'DSP-9999', 'note_added', 'System', 'Orphan', '2026-01-01T00:00:00.000Z')");
    db.pragma("foreign_keys = ON");
    const before = db.prepare("SELECT * FROM disputes ORDER BY id").all();
    expect(() => migrateDatabase(db)).toThrow(/foreign key check/);
    expect(db.prepare("SELECT * FROM disputes ORDER BY id").all()).toEqual(before);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'customers'").get()).toBeUndefined();
    expect(db.pragma("user_version", { simple: true })).toBe(0);
    expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
  });

  it("retains the transaction sequence after reopening and deletion of its highest row", () => {
    const directory = mkdtempSync(join(homedir(), ".dispute-migration-test-"));
    directories.push(directory);
    const filename = join(directory, "disputes.sqlite");
    const legacy = legacyDatabase(filename);
    legacy.close();
    const first = openDatabase(filename);
    first.exec("DELETE FROM disputes WHERE id = 'DSP-1003'");
    first.close();
    const second = openDatabase(filename);
    databases.push(second);
    second.exec(`
      INSERT INTO disputes
        SELECT 'DSP-1004', NULL, customer_id, customer_name, amount, currency,
          reason_code, status, date_received, network_deadline, assigned_agent,
          risk_score, notes, created_at, updated_at
        FROM disputes WHERE id = 'DSP-1001';
    `);
    expect(second.prepare("SELECT transaction_id FROM disputes WHERE id = 'DSP-1004'").get())
      .toEqual({ transaction_id: 4 });
    expect(second.prepare("SELECT COUNT(*) AS count FROM disputes").get()).toEqual({ count: 3 });
  });
});
