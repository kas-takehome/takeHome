import express from "express";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "./database";
import { createApp } from "./app";

process.umask(0o077);
const db = openDatabase(process.env.DATABASE_PATH);
const app = createApp(db);
const production = process.argv.includes("--production");
if (production) {
  const dist = fileURLToPath(new URL("../dist/", import.meta.url));
  app.use(express.static(dist));
  app.get("/{*path}", (_req, res) => {
    res.sendFile(resolve(dist, "index.html"));
  });
}
const port = Number(process.env.PORT || 3001);
const server = app.listen(port, "127.0.0.1", () => {
  console.info(
    `Dispute Triage API ready on port ${port}. Synthetic data only.`,
  );
});
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () =>
    server.close(() => {
      db.close();
      process.exit(0);
    }),
  );
}
