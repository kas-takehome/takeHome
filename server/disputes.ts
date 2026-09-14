import { randomUUID } from "node:crypto";
import type { DB } from "./database";
import {
  agents,
  HOUR,
  isActive,
  statusLabels,
  statuses,
  type CreateDisputeInput,
  type Customer,
  type Dispute,
  type DisputeDetail,
  type DisputeEvent,
  type EventType,
  type Status,
  type Summary,
} from "../shared/domain";

export class RequestError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function getDispute(db: DB, id: string): Dispute {
  const dispute = db.prepare("SELECT * FROM disputes WHERE id = ?").get(id) as
    | Dispute
    | undefined;
  if (!dispute) throw new RequestError(404, "Dispute not found.");
  return dispute;
}

export function getDetail(db: DB, id: string): DisputeDetail {
  const dispute = getDispute(db, id);
  const events = db
    .prepare(
      "SELECT * FROM dispute_events WHERE dispute_id = ? ORDER BY created_at DESC, id DESC",
    )
    .all(id) as DisputeEvent[];
  const seed = [...String(dispute.customer_id)].reduce(
    (sum, char) => sum + char.charCodeAt(0),
    0,
  );
  const merchants = [
    "Atlas Supply Co.",
    "Northstar Market",
    "Juniper Coffee",
    "Cloudline Software",
  ];
  const transactions = Array.from({ length: 2 + (seed % 3) }, (_, i) => ({
    id: `txn_prior_${seed}_${i}`,
    merchant: merchants[(seed + i) % merchants.length],
    amount: 1599 + ((seed * (i + 3) * 71) % 25000),
    currency: dispute.currency,
    date: new Date(
      new Date(dispute.date_received).getTime() - (i + 1) * 8 * 24 * HOUR,
    ).toISOString(),
  }));
  return {
    dispute,
    events,
    transactions,
    risk: [
      {
        label: "Device fingerprint",
        value:
          dispute.risk_score >= 65
            ? "Previously unseen device"
            : "Recognized device",
      },
      {
        label: "Address verification",
        value: dispute.risk_score >= 80 ? "Partial match" : "Match",
      },
      {
        label: "Purchase pattern",
        value:
          dispute.risk_score >= 50
            ? "Above typical spend"
            : "Consistent with history",
      },
      { label: "Account age", value: `${6 + (seed % 36)} months` },
    ],
  };
}

function addEvent(
  db: DB,
  disputeId: string,
  type: EventType,
  actor: string,
  detail: string,
  now: string,
) {
  db.prepare("INSERT INTO dispute_events VALUES (?, ?, ?, ?, ?, ?)").run(
    randomUUID(),
    disputeId,
    type,
    actor,
    detail,
    now,
  );
}

export function createDispute(
  db: DB,
  actor: string,
  input: CreateDisputeInput,
) {
  return db
    .transaction(() => {
      const customer = db
        .prepare(
          "SELECT customer_id, customer_name FROM customers WHERE customer_id = ?",
        )
        .get(input.customer_id) as Customer | undefined;
      if (!customer)
        throw new RequestError(400, "Choose an existing customer.");
      if (
        input.assigned_agent &&
        !agents.includes(input.assigned_agent) &&
        !db
          .prepare("SELECT 1 FROM disputes WHERE assigned_agent = ?")
          .get(input.assigned_agent)
      )
        throw new RequestError(
          400,
          "Choose an existing agent or leave unassigned.",
        );
      const { next_id } = db
        .prepare(
          "SELECT COALESCE(MAX(CAST(SUBSTR(id, 5) AS INTEGER)), 1000) + 1 AS next_id FROM disputes",
        )
        .get() as { next_id: number };
      if (next_id > 999999999999)
        throw new RequestError(409, "Dispute ID limit reached.");
      const received = Date.now();
      const now = new Date(received).toISOString();
      const dispute: Omit<Dispute, "transaction_id"> = {
        ...input,
        customer_name: customer.customer_name,
        id: `DSP-${next_id}`,
        status: "new",
        date_received: now,
        network_deadline: new Date(received + 7 * 24 * HOUR).toISOString(),
        risk_score: [...String(input.customer_id)].reduce(
          (score, char) => (score * 31 + char.charCodeAt(0)) % 101,
          0,
        ),
        created_at: now,
        updated_at: now,
      };
      db.prepare(
        `INSERT INTO disputes (
        id, customer_id, customer_name, amount, currency,
        reason_code, status, date_received, network_deadline, assigned_agent,
        risk_score, notes, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )`,
      ).run(
        dispute.id,
        dispute.customer_id,
        dispute.customer_name,
        dispute.amount,
        dispute.currency,
        dispute.reason_code,
        dispute.status,
        dispute.date_received,
        dispute.network_deadline,
        dispute.assigned_agent,
        dispute.risk_score,
        dispute.notes,
        dispute.created_at,
        dispute.updated_at,
      );
      addEvent(
        db,
        dispute.id,
        "status_change",
        actor,
        "Dispute created with status New",
        now,
      );
      if (input.assigned_agent)
        addEvent(
          db,
          dispute.id,
          "assigned",
          actor,
          `Assigned to ${input.assigned_agent}`,
          now,
        );
      if (input.notes)
        addEvent(db, dispute.id, "note_added", actor, input.notes, now);
      return getDetail(db, dispute.id);
    })
    .immediate();
}

export function changeDispute(
  db: DB,
  id: string,
  actor: string,
  input: {
    expected_updated_at: string;
    status?: Status;
    assigned_agent?: string | null;
  },
) {
  return db
    .transaction(() => changeWithinTransaction(db, id, actor, input))
    .immediate();
}

function changeWithinTransaction(
  db: DB,
  id: string,
  actor: string,
  input: {
    expected_updated_at: string;
    status?: Status;
    assigned_agent?: string | null;
  },
) {
  const dispute = getDispute(db, id);
  if (input.expected_updated_at !== dispute.updated_at)
    throw new RequestError(
      409,
      "This dispute changed. Refresh the details and try again.",
    );
  const now = new Date(
    Math.max(Date.now(), Date.parse(dispute.updated_at) + 1),
  ).toISOString();
  let changed = false;
  if (input.status !== undefined && input.status !== dispute.status) {
    db.prepare("UPDATE disputes SET status = ? WHERE id = ?").run(
      input.status,
      id,
    );
    addEvent(
      db,
      id,
      input.status === "evidence_submitted"
        ? "evidence_submitted"
        : "status_change",
      actor,
      `Status changed from ${statusLabels[dispute.status]} to ${statusLabels[input.status]}`,
      now,
    );
    changed = true;
  }
  if (
    input.assigned_agent !== undefined &&
    input.assigned_agent !== dispute.assigned_agent
  ) {
    db.prepare("UPDATE disputes SET assigned_agent = ? WHERE id = ?").run(
      input.assigned_agent,
      id,
    );
    addEvent(
      db,
      id,
      "assigned",
      actor,
      input.assigned_agent
        ? `Assigned to ${input.assigned_agent}`
        : "Removed agent assignment",
      now,
    );
    changed = true;
  }
  if (changed)
    db.prepare("UPDATE disputes SET updated_at = ? WHERE id = ?").run(now, id);
  return getDetail(db, id);
}

export function appendNote(db: DB, id: string, actor: string, note: string) {
  return db
    .transaction(() => {
      const dispute = getDispute(db, id);
      const notes = dispute.notes ? `${dispute.notes}\n\n${note}` : note;
      if (notes.length > 64000)
        throw new RequestError(
          400,
          "This dispute has reached its note storage limit.",
        );
      const now = new Date(
        Math.max(Date.now(), Date.parse(dispute.updated_at) + 1),
      ).toISOString();
      db.prepare(
        "UPDATE disputes SET notes = ?, updated_at = ? WHERE id = ?",
      ).run(notes, now, id);
      addEvent(db, id, "note_added", actor, note, now);
      return getDetail(db, id);
    })
    .immediate();
}

export function bulkStatus(
  db: DB,
  actor: string,
  items: { id: string; expected_updated_at: string }[],
  status: Status,
) {
  return db
    .transaction(() => {
      let updated = 0;
      for (const item of items) {
        const before = getDispute(db, item.id);
        changeWithinTransaction(db, item.id, actor, {
          expected_updated_at: item.expected_updated_at,
          status,
        });
        if (before.status !== status) updated += 1;
      }
      return { updated, unchanged: items.length - updated };
    })
    .immediate();
}

export function getSummary(db: DB, now = Date.now()): Summary {
  const rows = db
    .prepare("SELECT status, network_deadline, amount, currency FROM disputes")
    .all() as Pick<
    Dispute,
    "status" | "network_deadline" | "amount" | "currency"
  >[];
  const summary: Summary = {
    total: rows.length,
    by_status: {
      new: 0,
      investigating: 0,
      evidence_submitted: 0,
      won: 0,
      lost: 0,
      auto_resolved: 0,
      closed: 0,
    },
    due_48h: 0,
    overdue: 0,
    amount_at_risk: {},
    generated_at: new Date(now).toISOString(),
  };
  for (const status of statuses)
    summary.by_status[status] = rows.filter(
      (row) => row.status === status,
    ).length;
  for (const row of rows) {
    const remaining = Date.parse(row.network_deadline) - now;
    if (isActive(row.status)) {
      if (remaining < 0) summary.overdue++;
      else if (remaining < 48 * HOUR) summary.due_48h++;
    }
    if (row.status !== "closed")
      summary.amount_at_risk[row.currency] =
        (summary.amount_at_risk[row.currency] || 0) + row.amount;
  }
  return summary;
}
