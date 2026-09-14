export const statuses = [
  "new",
  "investigating",
  "evidence_submitted",
  "won",
  "lost",
  "auto_resolved",
  "closed",
] as const;
export type Status = (typeof statuses)[number];
export const reasons = [
  "fraud",
  "duplicate",
  "product_not_received",
  "product_not_as_described",
  "subscription_cancelled",
  "other",
] as const;
export type Reason = (typeof reasons)[number];
export const agents = [
  "Sarah Chen",
  "Marcus Lee",
  "Priya Patel",
  "James Okafor",
];
export const currencies = ["USD", "EUR", "GBP", "CAD", "AUD"] as const;
export const statusLabels: Record<Status, string> = {
  new: "New",
  investigating: "Investigating",
  evidence_submitted: "Evidence submitted",
  won: "Won",
  lost: "Lost",
  auto_resolved: "Auto-resolved",
  closed: "Closed",
};
export const reasonLabels: Record<Reason, string> = {
  fraud: "Fraud",
  duplicate: "Duplicate",
  product_not_received: "Product not received",
  product_not_as_described: "Not as described",
  subscription_cancelled: "Subscription cancelled",
  other: "Other",
};
export interface Customer {
  customer_id: number;
  customer_name: string;
}
export interface Dispute extends Customer {
  id: string;
  transaction_id: number;
  amount: number;
  currency: string;
  reason_code: Reason;
  status: Status;
  date_received: string;
  network_deadline: string;
  assigned_agent: string | null;
  risk_score: number;
  notes: string;
  created_at: string;
  updated_at: string;
}
export type CreateDisputeInput = Pick<
  Dispute,
  | "customer_id"
  | "amount"
  | "currency"
  | "reason_code"
  | "assigned_agent"
  | "notes"
>;
export type EventType =
  | "status_change"
  | "note_added"
  | "assigned"
  | "evidence_submitted";
export interface DisputeEvent {
  id: string;
  dispute_id: string;
  event_type: EventType;
  actor: string;
  detail: string;
  created_at: string;
}
export type Urgency = "overdue" | "urgent" | "upcoming" | "on_track";
export const HOUR = 3_600_000;
export function urgency(deadline: string, now = Date.now()): Urgency {
  const hours = (new Date(deadline).getTime() - now) / HOUR;
  if (hours < 0) return "overdue";
  if (hours < 48) return "urgent";
  if (hours <= 120) return "upcoming";
  return "on_track";
}
export function isActive(status: Status) {
  return (
    status === "new" ||
    status === "investigating" ||
    status === "evidence_submitted"
  );
}
export interface QueueResponse {
  disputes: Dispute[];
  total: number;
  agents: string[];
}
export interface MockTransaction {
  id: string;
  merchant: string;
  amount: number;
  currency: string;
  date: string;
}
export interface DisputeDetail {
  dispute: Dispute;
  events: DisputeEvent[];
  transactions: MockTransaction[];
  risk: { label: string; value: string }[];
}
export interface Summary {
  total: number;
  by_status: Record<Status, number>;
  due_48h: number;
  overdue: number;
  amount_at_risk: Record<string, number>;
  generated_at: string;
}
