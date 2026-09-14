import { openHostedDatabase } from "./hosted-database";
import { initializeDatabase } from "./database";

const db = openHostedDatabase();
try {
  initializeDatabase(db);
  console.info(
    "Hosted schema initialized. Existing disputes and audit history preserved.",
  );
} finally {
  db.close();
}
