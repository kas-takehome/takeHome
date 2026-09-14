import { createApp } from "../server/app";
import { createAuthentication, readAuthConfig } from "../server/auth";
import { openHostedDatabase } from "../server/hosted-database";

const config = readAuthConfig();
const db = openHostedDatabase();
if (db.pragma("user_version", { simple: true }) !== 1) {
  db.close();
  throw new Error(
    "Initialize the hosted database with npm run db:init:hosted before deploying.",
  );
}

export default createApp(db, createAuthentication(db, config));
