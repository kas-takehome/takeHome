import { AlertCircle, ArrowUpRight, Clock3, Inbox, Wallet } from "lucide-react";
import {
  statusLabels,
  statuses,
  type Status,
  type Summary,
} from "../shared/domain";
import { money } from "./format";

export interface SummaryFilter {
  status?: Status;
  urgency?: string;
  scope?: string;
}
export default function SummaryCards({
  summary,
  onFilter,
  status,
}: {
  summary: Summary | null;
  onFilter: (filter: SummaryFilter) => void;
  status: string;
}) {
  return (
    <section className="summary-section" aria-label="Workspace summary">
      <div className="summary-grid">
        <button className="summary-card" onClick={() => onFilter({})}>
          <div className="summary-label">
            Total disputes
            <Inbox size={15} />
          </div>
          <div className="summary-value">
            {summary?.total ?? "—"}
            <span className="summary-unit">cases</span>
          </div>
          <div className="summary-foot">
            Across all statuses
            <ArrowUpRight size={13} />
          </div>
        </button>
        <button
          className="summary-card"
          onClick={() => onFilter({ urgency: "urgent", scope: "active" })}
        >
          <div className="summary-label">
            Due in 48 hours
            <Clock3 size={15} />
          </div>
          <div className="summary-value">
            {summary?.due_48h ?? "—"}
            <span className="summary-tag">Time-sensitive</span>
          </div>
          <div className="summary-foot">
            Active cases approaching deadline
            <ArrowUpRight size={13} />
          </div>
        </button>
        <button
          className="summary-card overdue-card"
          onClick={() => onFilter({ urgency: "overdue", scope: "active" })}
        >
          <div className="summary-label">
            Overdue
            <AlertCircle size={15} />
          </div>
          <div className="summary-value">
            {summary?.overdue ?? "—"}
            <span className="overdue-pulse" />
          </div>
          <div className="summary-foot">
            Active cases past network deadline
            <ArrowUpRight size={13} />
          </div>
        </button>
        <button
          className="summary-card risk-card"
          onClick={() => onFilter({ scope: "non_closed" })}
        >
          <div className="summary-label">
            Amount at risk
            <Wallet size={15} />
          </div>
          <div className="summary-value">
            {summary
              ? Object.entries(summary.amount_at_risk).map(
                  ([currency, amount]) => (
                    <span key={currency}>
                      {money(amount, currency)}
                      <small>{currency}</small>
                    </span>
                  ),
                )
              : "—"}
          </div>
          <div className="summary-foot">
            All disputes except closed
            <ArrowUpRight size={13} />
          </div>
        </button>
      </div>
      <div className="status-breakdown">
        <span className="breakdown-label">BY STATUS</span>
        {statuses.map((value) => (
          <button
            key={value}
            className={status === value ? "selected-status" : ""}
            onClick={() => onFilter({ status: value })}
          >
            <span className={`breakdown-dot status-${value}`} />
            {statusLabels[value]}
            <strong>{summary?.by_status[value] ?? "—"}</strong>
          </button>
        ))}
      </div>
    </section>
  );
}
