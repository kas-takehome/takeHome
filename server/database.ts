import Database from "better-sqlite3";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { migrateDatabase } from "./migrations";
import {
  agents,
  HOUR,
  reasons,
  type Dispute,
  type Status,
} from "../shared/domain";

export interface DB {
  readonly open: boolean;
  prepare(sql: string): {
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    run(...params: unknown[]): {
      changes: number;
      lastInsertRowid: number | bigint;
    };
  };
  exec(sql: string): unknown;
  pragma(sql: string, options?: { simple?: boolean }): unknown;
  transaction<T>(fn: () => T): { (): T; immediate(): T };
  close(): unknown;
}
const root = fileURLToPath(new URL("../", import.meta.url));

export function openDatabase(
  filename = resolve(root, "data/disputes.sqlite"),
  now = Date.now(),
): Database.Database {
  if (filename !== ":memory:")
    mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
  const db = new Database(filename);
  if (filename !== ":memory:") chmodSync(filename, 0o600);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  try {
    initializeDatabase(db, now);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

export function initializeDatabase(db: DB, now = Date.now()) {
  migrateDatabase(db);
  db.transaction(() => {
    const { count } = db
      .prepare(
        "SELECT (SELECT COUNT(*) FROM disputes) + (SELECT COUNT(*) FROM customers) AS count",
      )
      .get() as { count: number };
    if (!count) seed(db, now);
  }).immediate();
}

function seed(db: DB, now: number) {
  const names = [
    "Olivia Martinez",
    "James Wilson",
    "Emma Thompson",
    "Liam Anderson",
    "Sophia Garcia",
    "Noah Williams",
    "Isabella Brown",
    "Ethan Davis",
    "Mia Robinson",
    "Lucas Johnson",
    "Amelia Walker",
    "Benjamin Hall",
    "Charlotte Young",
    "Mason King",
    "Harper Wright",
    "Elijah Scott",
    "Evelyn Green",
    "Oliver Adams",
    "Abigail Baker",
    "Aiden Nelson",
    "Emily Carter",
    "Henry Mitchell",
    "Elizabeth Perez",
    "Jack Roberts",
    "Sofia Turner",
    "Daniel Phillips",
    "Avery Campbell",
    "Michael Parker",
    "Ella Evans",
    "Sebastian Edwards",
    "Scarlett Collins",
    "Alexander Stewart",
    "Grace Morris",
    "William Rogers",
    "Chloe Reed",
    "Logan Cook",
    "Victoria Morgan",
    "Matthew Bell",
    "Riley Murphy",
    "David Bailey",
    "Aria Rivera",
    "Joseph Cooper",
    "Lily Richardson",
    "Samuel Cox",
    "Zoey Howard",
    "Gabriel Ward",
    "Nora Peterson",
    "Isaac Brooks",
  ];
  const amounts = [
    129900, 24900, 8950, 124500, 5900, 299500, 18500, 45000, 1599, 78900, 12900,
    34900,
  ];
  const offsets = [
    -64, -28, -8, 4, 9, 14, 20, 25, 31, 37, 43, 47, 54, 65, 76, 88, 100, 119,
    145, 180, 230, 310, 410, 520,
  ];
  const notes = [
    "Customer reports an unrecognized online purchase. Awaiting merchant documentation.",
    "Two identical charges appeared on the same day. Reviewing transaction records.",
    "Customer has not received the order. Requested shipping confirmation.",
    "Item received differs from the listing. Customer has provided photographs.",
    "Charge posted after the customer requested cancellation. Reviewing the cancellation date.",
    "Customer requested a review of this transaction. Additional information pending.",
  ];
  const insert = db.prepare(`INSERT INTO disputes VALUES (
    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
  )`);
  const customer = db.prepare(
    "INSERT INTO customers (customer_id, customer_name) VALUES (?, ?)",
  );
  const event = db.prepare(
    "INSERT INTO dispute_events VALUES (?, ?, ?, ?, ?, ?)",
  );
  names.forEach((name, i) => {
    customer.run(i + 1, name);
    const status: Status =
      i < 12
        ? "new"
        : i < 26
          ? "investigating"
          : i < 34
            ? "evidence_submitted"
            : i < 39
              ? "won"
              : i < 43
                ? "lost"
                : i < 46
                  ? "auto_resolved"
                  : "closed";
    const created = new Date(now - (7 + (i % 18)) * 24 * HOUR).toISOString();
    const updated = new Date(now - (i + 1) * HOUR).toISOString();
    const record: Dispute = {
      id: `DSP-${1048 - i}`,
      transaction_id: i + 1,
      customer_id: i + 1,
      customer_name: name,
      amount: amounts[i % amounts.length] + Math.floor(i / 12) * 100,
      currency: "USD",
      reason_code: reasons[i % reasons.length],
      status,
      date_received: created,
      network_deadline: new Date(
        now + offsets[i % offsets.length] * HOUR,
      ).toISOString(),
      assigned_agent: i % 5 === 0 ? null : agents[i % 4],
      risk_score: (i * 19 + 76) % 101,
      notes: notes[i % notes.length],
      created_at: created,
      updated_at: updated,
    };
    insert.run(
      record.id,
      record.transaction_id,
      record.customer_id,
      record.customer_name,
      record.amount,
      record.currency,
      record.reason_code,
      record.status,
      record.date_received,
      record.network_deadline,
      record.assigned_agent,
      record.risk_score,
      record.notes,
      record.created_at,
      record.updated_at,
    );
    event.run(
      `seed-${i}-note`,
      record.id,
      "note_added",
      "System · demo seed",
      record.notes,
      created,
    );
    if (record.assigned_agent)
      event.run(
        `seed-${i}-assigned`,
        record.id,
        "assigned",
        "System · demo seed",
        `Assigned to ${record.assigned_agent}`,
        created,
      );
    if (status !== "new")
      event.run(
        `seed-${i}-status`,
        record.id,
        status === "evidence_submitted"
          ? "evidence_submitted"
          : "status_change",
        "System · demo seed",
        `Status changed from new to ${status}`,
        updated,
      );
  });
}
