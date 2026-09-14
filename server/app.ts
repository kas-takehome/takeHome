import express, {
  type ErrorRequestHandler,
  type RequestHandler,
} from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { type DB } from "./database";
import {
  authorize,
  protectMutation,
  resolveActor,
  requireLocalHost,
  safeText,
  type Actor,
} from "./security";
import {
  appendNote,
  bulkStatus,
  changeDispute,
  createDispute,
  getDetail,
  getSummary,
  RequestError,
} from "./disputes";
import {
  agents,
  currencies,
  reasons,
  statuses,
  urgency,
  type Customer,
  type Dispute,
} from "../shared/domain";

const queueQuery = z
  .object({
    search: z.string().trim().max(120).default(""),
    status: z.enum(statuses).optional(),
    reason: z.enum(reasons).optional(),
    agent: z.string().max(100).optional(),
    assignment: z.enum(["assigned", "unassigned"]).optional(),
    scope: z.enum(["active", "non_closed"]).optional(),
    urgency: z.enum(["overdue", "urgent", "upcoming", "on_track"]).optional(),
    sort: z
      .enum(["network_deadline", "amount", "status"])
      .default("network_deadline"),
    order: z.enum(["asc", "desc"]).default("asc"),
  })
  .strict();
const disputeId = z.string().regex(/^DSP-\d{1,12}$/);
const updateInput = z
  .object({
    expected_updated_at: z.string().datetime(),
    status: z.enum(statuses).optional(),
    assigned_agent: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .pipe(safeText)
      .nullable()
      .optional(),
  })
  .strict()
  .refine(
    (input) => input.status !== undefined || input.assigned_agent !== undefined,
  );
const noteInput = z
  .object({ note: z.string().trim().min(1).max(4000).pipe(safeText) })
  .strict();
const createInput = z
  .object({
    customer_id: z.number().int().positive().safe(),
    amount: z.number().int().min(1).max(999999999),
    currency: z.enum(currencies),
    reason_code: z.enum(reasons),
    assigned_agent: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .pipe(safeText)
      .nullable()
      .default(null),
    notes: z.string().trim().max(4000).pipe(safeText).default(""),
  })
  .strict();
const bulkInput = z
  .object({
    disputes: z
      .array(
        z
          .object({
            id: disputeId,
            expected_updated_at: z.string().datetime(),
          })
          .strict(),
      )
      .min(1)
      .max(100)
      .refine(
        (items) => new Set(items.map((item) => item.id)).size === items.length,
      ),
    status: z.enum(statuses),
  })
  .strict();

export function createApp(db: DB, identity: RequestHandler = resolveActor) {
  const app = express();
  app.disable("x-powered-by");
  app.use(
    helmet({
      contentSecurityPolicy: { directives: { upgradeInsecureRequests: null } },
    }),
  );
  app.use(requireLocalHost);
  app.use("/api", (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  app.use(
    "/api",
    rateLimit({
      windowMs: 60_000,
      limit: 300,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: {
        error: "Too many requests. Please wait a minute and try again.",
      },
    }),
  );
  app.use(express.json({ limit: "16kb" }));
  app.use("/api", identity);
  const writeLimit = rateLimit({
    windowMs: 60_000,
    limit: 60,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many changes. Please wait a minute and try again." },
  });
  app.use("/api", (req, res, next) => {
    if (["POST", "PATCH", "PUT", "DELETE"].includes(req.method)) {
      protectMutation(req, res, () =>
        writeLimit(req, res, () => authorize("disputes:write")(req, res, next)),
      );
    } else next();
  });
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });
  app.get("/api/customers", authorize("disputes:read"), (_req, res) => {
    const customers = db
      .prepare(
        "SELECT customer_id, customer_name FROM customers ORDER BY customer_name COLLATE NOCASE, customer_id",
      )
      .all() as Customer[];
    res.json({ customers });
  });
  app.get("/api/disputes", authorize("disputes:read"), (req, res) => {
    const query = queueQuery.parse(req.query);
    const clauses: string[] = [];
    const values: string[] = [];
    if (query.search) {
      clauses.push(
        "(customer_name LIKE ? ESCAPE '\\' OR transaction_id LIKE ? ESCAPE '\\')",
      );
      const search = `%${query.search.replace(/[\\%_]/g, "\\$&")}%`;
      values.push(search, search);
    }
    if (query.status) {
      clauses.push("status = ?");
      values.push(query.status);
    }
    if (query.scope === "active")
      clauses.push("status IN ('new', 'investigating', 'evidence_submitted')");
    if (query.scope === "non_closed") clauses.push("status != 'closed'");
    if (query.reason) {
      clauses.push("reason_code = ?");
      values.push(query.reason);
    }
    if (
      query.assignment === "unassigned" ||
      (!query.assignment && query.agent === "unassigned")
    )
      clauses.push("assigned_agent IS NULL");
    else if (query.agent) {
      clauses.push("assigned_agent = ?");
      values.push(query.agent);
    } else if (query.assignment === "assigned")
      clauses.push("assigned_agent IS NOT NULL");
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = db
      .prepare(
        `SELECT * FROM disputes ${where} ORDER BY ${query.sort} ${query.order}, id DESC`,
      )
      .all(...values) as Dispute[];
    const now = Date.now();
    const disputes = query.urgency
      ? rows.filter(
          (row) => urgency(row.network_deadline, now) === query.urgency,
        )
      : rows;
    const assignedAgents = db
      .prepare(
        "SELECT DISTINCT assigned_agent FROM disputes WHERE assigned_agent IS NOT NULL ORDER BY assigned_agent",
      )
      .all() as { assigned_agent: string }[];
    res.json({
      disputes,
      total: disputes.length,
      agents: [
        ...new Set([
          ...agents,
          ...assignedAgents.map((row) => row.assigned_agent),
        ]),
      ],
    });
  });
  app.get("/api/summary", authorize("disputes:read"), (_req, res) => {
    res.json(getSummary(db));
  });
  app.post("/api/disputes", (req, res) => {
    const actor = res.locals.actor as Actor;
    const result = createDispute(db, actor.name, createInput.parse(req.body));
    res.status(201).location(`/api/disputes/${result.dispute.id}`).json(result);
  });
  app.post("/api/disputes/bulk-status", (req, res) => {
    const actor = res.locals.actor as Actor;
    const input = bulkInput.parse(req.body);
    res.json(bulkStatus(db, actor.name, input.disputes, input.status));
  });
  app.get("/api/disputes/:id", authorize("disputes:read"), (req, res) => {
    res.json(getDetail(db, disputeId.parse(req.params.id)));
  });
  app.patch("/api/disputes/:id", (req, res) => {
    const actor = res.locals.actor as Actor;
    res.json(
      changeDispute(
        db,
        disputeId.parse(req.params.id),
        actor.name,
        updateInput.parse(req.body),
      ),
    );
  });
  app.post("/api/disputes/:id/notes", (req, res) => {
    const actor = res.locals.actor as Actor;
    const input = noteInput.parse(req.body);
    res
      .status(201)
      .json(
        appendNote(db, disputeId.parse(req.params.id), actor.name, input.note),
      );
  });
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Endpoint not found." });
  });
  const errors: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    if (error instanceof RequestError) {
      res.status(error.status).json({ error: error.message });
    } else if (error instanceof z.ZodError) {
      const sensitive = error.issues.find((issue) =>
        issue.message.startsWith("Do not include"),
      );
      res.status(400).json({
        error:
          sensitive?.message || "Invalid request. Check the submitted fields.",
      });
    } else if (error instanceof SyntaxError) {
      res.status(400).json({ error: "Invalid JSON." });
    } else if (
      error instanceof Error &&
      "status" in error &&
      error.status === 413
    ) {
      res.status(413).json({ error: "Request is too large." });
    } else {
      res.status(500).json({ error: "Unable to complete the request." });
    }
  };
  app.use(errors);
  return app;
}
