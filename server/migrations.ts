import type { DB } from "./database";

export function migrateDatabase(db: DB) {
  db.pragma("foreign_keys = OFF");
  try {
    db.transaction(() => {
      const version = db.pragma("user_version", { simple: true }) as number;
      if (version > 1) throw new Error("Unsupported database schema version.");
      if (version === 1) return;
      const legacy = db
        .prepare(
          "SELECT 1 FROM pragma_table_info('disputes') WHERE name = 'customer_id' AND type = 'TEXT'",
        )
        .get();
      const table = legacy ? "disputes_new" : "disputes";
      db.exec(`
        CREATE TABLE customers (
          customer_id INTEGER PRIMARY KEY AUTOINCREMENT CHECK (customer_id BETWEEN 1 AND 9007199254740991),
          customer_name TEXT NOT NULL CHECK (length(trim(customer_name)) > 0)
        );
        CREATE TABLE ${table} (
          id TEXT NOT NULL UNIQUE,
          transaction_id INTEGER PRIMARY KEY AUTOINCREMENT CHECK (transaction_id BETWEEN 1 AND 9007199254740991),
          customer_id INTEGER NOT NULL REFERENCES customers(customer_id), customer_name TEXT NOT NULL,
          amount INTEGER NOT NULL CHECK (amount >= 0), currency TEXT NOT NULL,
          reason_code TEXT NOT NULL CHECK (reason_code IN ('fraud','duplicate','product_not_received','product_not_as_described','subscription_cancelled','other')),
          status TEXT NOT NULL CHECK (status IN ('new','investigating','evidence_submitted','won','lost','auto_resolved','closed')),
          date_received TEXT NOT NULL, network_deadline TEXT NOT NULL,
          assigned_agent TEXT, risk_score INTEGER NOT NULL CHECK (risk_score BETWEEN 0 AND 100),
          notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
      `);
      if (legacy) {
        db.exec(`
          CREATE TEMP TABLE customer_id_map (
            legacy_id TEXT PRIMARY KEY, customer_id INTEGER NOT NULL UNIQUE
          );
          INSERT INTO customer_id_map
            SELECT customer_id, ROW_NUMBER() OVER (ORDER BY customer_id)
            FROM disputes GROUP BY customer_id;
          INSERT INTO customers
            SELECT m.customer_id, (
              SELECT d.customer_name FROM disputes d WHERE d.customer_id = m.legacy_id
              ORDER BY d.created_at, d.id LIMIT 1
            ) FROM customer_id_map m;
          INSERT INTO disputes_new
            SELECT d.id, ROW_NUMBER() OVER (ORDER BY d.created_at, d.id),
              m.customer_id, d.customer_name, d.amount, d.currency, d.reason_code,
              d.status, d.date_received, d.network_deadline, d.assigned_agent,
              d.risk_score, d.notes, d.created_at, d.updated_at
            FROM disputes d JOIN customer_id_map m ON m.legacy_id = d.customer_id;
          DROP TABLE disputes;
          ALTER TABLE disputes_new RENAME TO disputes;
          DROP TABLE customer_id_map;
        `);
      }
      db.exec(`
        CREATE TABLE IF NOT EXISTS dispute_events (
          id TEXT PRIMARY KEY, dispute_id TEXT NOT NULL REFERENCES disputes(id),
          event_type TEXT NOT NULL CHECK (event_type IN ('status_change','note_added','assigned','evidence_submitted')),
          actor TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS disputes_deadline_idx ON disputes(network_deadline);
        CREATE INDEX IF NOT EXISTS disputes_status_idx ON disputes(status);
        CREATE INDEX IF NOT EXISTS disputes_customer_idx ON disputes(customer_id);
        CREATE INDEX IF NOT EXISTS dispute_events_dispute_idx ON dispute_events(dispute_id, created_at DESC);
        CREATE TRIGGER IF NOT EXISTS events_no_update BEFORE UPDATE ON dispute_events
          BEGIN SELECT RAISE(ABORT, 'Audit events cannot be changed'); END;
        CREATE TRIGGER IF NOT EXISTS events_no_delete BEFORE DELETE ON dispute_events
          BEGIN SELECT RAISE(ABORT, 'Audit events cannot be deleted'); END;
      `);
      if (db.prepare("SELECT 1 FROM pragma_foreign_key_check LIMIT 1").get())
        throw new Error("Database migration failed its foreign key check.");
      db.pragma("user_version = 1");
    }).immediate();
  } finally {
    db.pragma("foreign_keys = ON");
  }
}
