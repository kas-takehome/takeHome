import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "./app";
import { openDatabase, type DB } from "./database";
import type { Customer, DisputeDetail } from "../shared/domain";
import type { Actor } from "./security";

let db: DB;
beforeEach(() => {
  db = openDatabase(":memory:");
});
afterEach(() => db.close());

describe("existing customers", () => {
  it("returns the complete customer list, including customers without disputes", async () => {
    const newCustomer = db
      .prepare("INSERT INTO customers (customer_name) VALUES (?)")
      .run("Olivia Martinez");
    const response = await request(createApp(db)).get("/api/customers").expect(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    const { customers } = response.body as { customers: Customer[] };
    expect(customers).toHaveLength(49);
    expect(customers).toEqual(
      db.prepare("SELECT * FROM customers ORDER BY customer_name COLLATE NOCASE, customer_id").all(),
    );
    expect(customers.filter((customer) => customer.customer_name === "Olivia Martinez")).toEqual([
      { customer_id: 1, customer_name: "Olivia Martinez" },
      { customer_id: Number(newCustomer.lastInsertRowid), customer_name: "Olivia Martinez" },
    ]);
    const created = await request(createApp(db))
      .post("/api/disputes")
      .set("X-Dispute-Client", "internal-web")
      .send({
        customer_id: Number(newCustomer.lastInsertRowid),
        amount: 100, currency: "USD", reason_code: "fraud",
      })
      .expect(201);
    expect((created.body as DisputeDetail).dispute.customer_name).toBe("Olivia Martinez");
    expect((created.body as DisputeDetail).dispute.customer_id).toBe(Number(newCustomer.lastInsertRowid));
  });

  it("requires read permission before disclosing customer data", async () => {
    const actor: Actor = { id: "denied", name: "Denied", permissions: [] };
    const app = createApp(db, (_req, res, next) => {
      res.locals.actor = actor;
      next();
    });
    const response = await request(app).get("/api/customers").expect(403);
    expect(response.text).not.toContain("Olivia");
  });
});
