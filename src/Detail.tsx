import { useEffect, useState, type FormEvent } from "react";
import {
  Activity,
  ArrowRight,
  Clock3,
  CreditCard,
  FileText,
  MessageSquare,
  RefreshCw,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";
import {
  reasonLabels,
  statusLabels,
  statuses,
  type DisputeDetail,
  type Status,
} from "../shared/domain";
import { api } from "./api";
import { fullDate, initials, money, date } from "./format";
import { Select, StatusBadge, UrgencyBadge } from "./components";
import Modal from "./Modal";

export default function Detail({
  id,
  agentOptions,
  onClose,
  onChange,
}: {
  id: string;
  agentOptions: string[];
  onClose: () => void;
  onChange: () => void;
}) {
  const [data, setData] = useState<DisputeDetail | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [agent, setAgent] = useState("");
  const [note, setNote] = useState("");
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    api<DisputeDetail>(`/disputes/${encodeURIComponent(id)}`, {
      signal: controller.signal,
    })
      .then((result) => {
        setData(result);
        setAgent(result.dispute.assigned_agent || "");
        setError("");
      })
      .catch((err: Error) => {
        if (err.name !== "AbortError") setError(err.message);
      });
    return () => controller.abort();
  }, [id, revision]);
  async function update(change: {
    status?: Status;
    assigned_agent?: string | null;
  }) {
    if (!data) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await api<DisputeDetail>(`/disputes/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          ...change,
          expected_updated_at: data.dispute.updated_at,
        }),
      });
      setData(result);
      setAgent(result.dispute.assigned_agent || "");
      setNotice("Changes saved and logged.");
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save.");
    } finally {
      setBusy(false);
    }
  }
  async function addNote(e: FormEvent) {
    e.preventDefault();
    if (!note.trim()) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      setData(
        await api<DisputeDetail>(`/disputes/${id}/notes`, {
          method: "POST",
          body: JSON.stringify({ note: note.trim() }),
        }),
      );
      setNote("");
      setNotice("Note added to the audit log.");
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to add note.");
    } finally {
      setBusy(false);
    }
  }
  const dispute = data?.dispute;
  const assignmentAgents = [
    ...new Set([
      ...agentOptions,
      ...(dispute?.assigned_agent ? [dispute.assigned_agent] : []),
    ]),
  ];
  return (
    <Modal
      className="detail-drawer"
      labelledBy="detail-title"
      onClose={onClose}
    >
      <div className="drawer-header">
        <div>
          <FileText size={16} />
          <span>Dispute details</span>
          <span className="header-slash">/</span>
          <strong id="detail-title">{id}</strong>
        </div>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Close dispute details"
          autoFocus
        >
          <X size={20} />
        </button>
      </div>
      {error && (
        <div className="error-banner" role="alert">
          {error}
          <button onClick={() => setRevision((v) => v + 1)}>
            Refresh details
          </button>
        </div>
      )}
      {!dispute || !data ? (
        <div className="empty-state">
          {!error && (
            <>
              <RefreshCw size={24} className="spin" />
              <p>Loading dispute details…</p>
            </>
          )}
        </div>
      ) : (
        <>
          <div className="detail-heading">
            <div className="detail-customer">
              <span className="customer-avatar">
                {initials(dispute.customer_name)}
              </span>
              <div>
                <h2>{dispute.customer_name}</h2>
                <span className="mono">{dispute.customer_id}</span>
              </div>
            </div>
            <div className="detail-amount">
              <strong>{money(dispute.amount, dispute.currency)}</strong>
              <span>{dispute.currency} · disputed amount</span>
            </div>
          </div>
          <div className="detail-layout">
            <div className="detail-main">
              <section className="detail-card">
                <h3>
                  <FileText size={15} />
                  Case overview
                  <StatusBadge status={dispute.status} />
                </h3>
                <dl className="detail-facts">
                  <div>
                    <dt>Reason code</dt>
                    <dd>{reasonLabels[dispute.reason_code]}</dd>
                  </div>
                  <div>
                    <dt>Received</dt>
                    <dd title={fullDate(dispute.date_received)}>
                      {date(dispute.date_received)}
                    </dd>
                  </div>
                  <div>
                    <dt>Transaction ID</dt>
                    <dd className="mono">{dispute.transaction_id}</dd>
                  </div>
                  <div>
                    <dt>Network deadline</dt>
                    <dd>
                      {fullDate(dispute.network_deadline)}
                      <UrgencyBadge deadline={dispute.network_deadline} />
                    </dd>
                  </div>
                  <div>
                    <dt>Created</dt>
                    <dd>{fullDate(dispute.created_at)}</dd>
                  </div>
                  <div>
                    <dt>Last updated</dt>
                    <dd>{fullDate(dispute.updated_at)}</dd>
                  </div>
                </dl>
              </section>
              <section className="detail-card">
                <h3>
                  <CreditCard size={15} />
                  Linked transactions<span className="mock-label">MOCK</span>
                </h3>
                <p className="card-description">
                  Prior transactions for this customer. No payment credentials
                  are stored.
                </p>
                <div className="prior-transactions">
                  {data.transactions.map((transaction) => (
                    <div key={transaction.id}>
                      <span className="transaction-icon">
                        <CreditCard size={15} />
                      </span>
                      <div>
                        <strong>{transaction.merchant}</strong>
                        <span>
                          {date(transaction.date)} · {transaction.id}
                        </span>
                      </div>
                      <b>{money(transaction.amount, transaction.currency)}</b>
                    </div>
                  ))}
                </div>
              </section>
              <section className="detail-card">
                <h3>
                  <ShieldCheck size={15} />
                  Risk signals<span className="mock-label">MOCK</span>
                </h3>
                <div className="risk-overview">
                  <span
                    className={`risk-number risk-${dispute.risk_score >= 70 ? "high" : dispute.risk_score >= 40 ? "medium" : "low"}`}
                  >
                    {dispute.risk_score}
                    <small>/100</small>
                  </span>
                  <div>
                    <strong>
                      {dispute.risk_score >= 70
                        ? "Elevated risk"
                        : dispute.risk_score >= 40
                          ? "Moderate risk"
                          : "Low risk"}
                    </strong>
                    <span>Synthetic signals · for demonstration only</span>
                  </div>
                </div>
                <div className="risk-signals">
                  {data.risk.map((signal) => (
                    <div key={signal.label}>
                      <span>{signal.label}</span>
                      <strong>{signal.value}</strong>
                    </div>
                  ))}
                </div>
              </section>
              <section className="detail-card">
                <h3>
                  <Activity size={15} />
                  Audit timeline
                  <span className="timeline-count">{data.events.length}</span>
                </h3>
                <p className="card-description">
                  Newest first · All timestamps in UTC
                </p>
                <ol className="timeline">
                  {data.events.map((event) => (
                    <li key={event.id}>
                      <span className="timeline-icon">
                        {event.event_type === "note_added" ? (
                          <MessageSquare size={13} />
                        ) : event.event_type === "assigned" ? (
                          <UserRound size={13} />
                        ) : (
                          <ArrowRight size={13} />
                        )}
                      </span>
                      <div>
                        <div className="timeline-title">
                          <strong>{event.actor}</strong>
                          <span>{event.event_type.replaceAll("_", " ")}</span>
                        </div>
                        <p>{event.detail}</p>
                        <time dateTime={event.created_at}>
                          {fullDate(event.created_at)}
                        </time>
                      </div>
                    </li>
                  ))}
                </ol>
              </section>
            </div>
            <aside className="detail-controls">
              <h3>CASE MANAGEMENT</h3>
              <label className="field-label" htmlFor="detail-status">
                Status
              </label>
              <Select
                className="full-select"
                id="detail-status"
                value={dispute.status}
                disabled={busy}
                onChange={(e) =>
                  void update({ status: e.target.value as Status })
                }
              >
                {statuses.map((value) => (
                  <option key={value} value={value}>
                    {statusLabels[value]}
                  </option>
                ))}
              </Select>
              <p className="field-hint">
                Changes are saved and audit logged immediately. Evidence status
                does not upload files.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void update({ assigned_agent: agent || null });
                }}
              >
                <label className="field-label" htmlFor="agent">
                  Assigned agent
                </label>
                <Select
                  id="agent"
                  className="full-select"
                  value={agent}
                  disabled={busy}
                  onChange={(e) => setAgent(e.target.value)}
                >
                  <option value="">Unassigned (no agent)</option>
                  {assignmentAgents.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </Select>
                <button
                  className="button secondary full-width"
                  disabled={
                    busy || agent === (dispute.assigned_agent || "")
                  }
                  type="submit"
                >
                  Save assignment
                </button>
              </form>
              <form className="note-form" onSubmit={(e) => void addNote(e)}>
                <label className="field-label" htmlFor="note">
                  Add an internal note
                </label>
                <textarea
                  id="note"
                  value={note}
                  disabled={busy}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={4000}
                  rows={5}
                  placeholder="Add context or next steps…"
                />
                <div className="note-counter">
                  {note.length.toLocaleString()} / 4,000
                </div>
                <p className="field-hint">
                  Never include card numbers, security codes, or real customer
                  data.
                </p>
                <button
                  className="button primary full-width"
                  type="submit"
                  disabled={busy || !note.trim()}
                >
                  <MessageSquare size={13} />
                  {busy ? "Saving…" : "Add note"}
                </button>
              </form>
              <div className="save-notice" role="status">
                {notice}
              </div>
              <div className="audit-assurance">
                <Clock3 size={14} />
                <span>
                  Updates are stored atomically with an append-only audit event.
                </span>
              </div>
            </aside>
          </div>
        </>
      )}
    </Modal>
  );
}
