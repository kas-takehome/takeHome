import Database from "better-sqlite3";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  agents,
  HOUR,
  reasons,
  type Dispute,
  type Status,
} from "../shared/domain";

export type DB = Database.Database;
const root = fileURLToPath(new URL("../", import.meta.url));

export function openDatabase(
  filename = resolve(root, "data/disputes.sqlite"),
  now = Date.now(),
): DB {
  if (filename !== ":memory:")
    mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
  const db = new Database(filename);
  if (filename !== ":memory:") chmodSync(filename, 0o600);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS disputes (
      id TEXT PRIMARY KEY, transaction_id TEXT NOT NULL UNIQUE,
      customer_id TEXT NOT NULL, customer_name TEXT NOT NULL,
      amount INTEGER NOT NULL CHECK (amount >= 0), currency TEXT NOT NULL,
      reason_code TEXT NOT NULL CHECK (reason_code IN ('fraud','duplicate','product_not_received','product_not_as_described','subscription_cancelled','other')),
      status TEXT NOT NULL CHECK (status IN ('new','investigating','evidence_submitted','won','lost','auto_resolved','closed')),
      date_received TEXT NOT NULL, network_deadline TEXT NOT NULL,
      assigned_agent TEXT, risk_score INTEGER NOT NULL CHECK (risk_score BETWEEN 0 AND 100),
      notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS dispute_events (
      id TEXT PRIMARY KEY, dispute_id TEXT NOT NULL REFERENCES disputes(id),
      event_type TEXT NOT NULL CHECK (event_type IN ('status_change','note_added','assigned','evidence_submitted')),
      actor TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS disputes_deadline_idx ON disputes(network_deadline);
    CREATE INDEX IF NOT EXISTS disputes_status_idx ON disputes(status);
    CREATE INDEX IF NOT EXISTS dispute_events_dispute_idx ON dispute_events(dispute_id, created_at DESC);
    CREATE TRIGGER IF NOT EXISTS events_no_update BEFORE UPDATE ON dispute_events
      BEGIN SELECT RAISE(ABORT, 'Audit events cannot be changed'); END;
    CREATE TRIGGER IF NOT EXISTS events_no_delete BEFORE DELETE ON dispute_events
      BEGIN SELECT RAISE(ABORT, 'Audit events cannot be deleted'); END;
  `);
  const count = db.prepare("SELECT COUNT(*) AS count FROM disputes").get() as {
    count: number;
  };
  if (!count.count) seed(db, now);
  return db;
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
    @id, @transaction_id, @customer_id, @customer_name, @amount, @currency,
    @reason_code, @status, @date_received, @network_deadline, @assigned_agent,
    @risk_score, @notes, @created_at, @updated_at
  )`);
  const event = db.prepare(
    "INSERT INTO dispute_events VALUES (?, ?, ?, ?, ?, ?)",
  );
  db.transaction(() =>
    names.forEach((name, i) => {
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
        transaction_id: `txn_${(948210 + i * 731).toString(16)}${(i * 17 + 83).toString(16)}`,
        customer_id: `cus_${70100 + i}`,
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
      insert.run(record);
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
    }),
  )();
}
