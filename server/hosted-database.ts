import Database from "libsql";
import type { DB } from "./database";

function withoutMetadata(row: unknown): unknown {
  if (row === null || typeof row !== "object") return row;
  return Object.fromEntries(
    Object.entries(row).filter(([key]) => key !== "_metadata"),
  );
}

export function adaptLibsql(connection: Database.Database): DB {
  return {
    get open() {
      return connection.open;
    },
    prepare(sql) {
      const statement = connection.prepare(sql);
      return {
        get: (...params) => withoutMetadata(statement.get(...params)),
        all: (...params) => statement.all(...params).map(withoutMetadata),
        run: (...params) => statement.run(...params),
      };
    },
    exec: (sql) => connection.exec(sql),
    pragma(sql, options) {
      const rows = connection
        .prepare(`PRAGMA ${sql}`)
        .all()
        .map(withoutMetadata);
      const first = rows[0];
      return options?.simple
        ? first && typeof first === "object"
          ? Object.values(first)[0]
          : undefined
        : rows;
    },
    transaction: (fn) => connection.transaction(fn),
    close: () => connection.close(),
  };
}

export function openHostedDatabase(): DB {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url || !authToken)
    throw new Error(
      "TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are required for hosted storage.",
    );
  const parsed = new URL(url);
  if (
    !["libsql:", "https:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password
  )
    throw new Error("TURSO_DATABASE_URL must use libsql:// or https://.");
  const options = { authToken, timeout: 5000 };
  const db = adaptLibsql(new Database(url, options));
  db.pragma("foreign_keys = ON");
  return db;
}
