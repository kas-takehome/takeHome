import { useState } from "react";
import { ArrowRight, Layers, X } from "lucide-react";
import {
  statusLabels,
  statuses,
  type Dispute,
  type Status,
} from "../shared/domain";
import { api } from "./api";
import { Select } from "./components";
import { money } from "./format";
import Modal from "./Modal";

export default function BulkAction({
  disputes,
  onClose,
  onSuccess,
}: {
  disputes: Dispute[];
  onClose: () => void;
  onSuccess: (message: string) => void;
}) {
  const [status, setStatus] = useState<Status>("closed");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    setBusy(true);
    setError("");
    try {
      const result = await api<{ updated: number; unchanged: number }>(
        "/disputes/bulk-status",
        {
          method: "POST",
          body: JSON.stringify({
            disputes: disputes.map((dispute) => ({
              id: dispute.id,
              expected_updated_at: dispute.updated_at,
            })),
            status,
          }),
        },
      );
      onSuccess(
        `${result.updated} dispute${result.updated === 1 ? "" : "s"} updated${result.unchanged ? ` · ${result.unchanged} already ${statusLabels[status].toLowerCase()}` : ""}. Changes audit logged.`,
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to update disputes.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      className="guide-modal bulk-modal"
      labelledBy="bulk-title"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <button
        className="icon-button modal-close"
        disabled={busy}
        onClick={onClose}
        aria-label="Cancel bulk update"
      >
        <X size={18} />
      </button>
      <div className="modal-feature-icon">
        <Layers size={21} />
      </div>
      <h2 id="bulk-title">Update {disputes.length} disputes</h2>
      <p>
        Review the selection before applying a status change. Each changed
        dispute will receive its own audit event.
      </p>
      <div className="bulk-preview">
        {disputes.slice(0, 4).map((dispute) => (
          <div key={dispute.id}>
            <span>
              {dispute.id} · {dispute.customer_name}
            </span>
            <strong>{money(dispute.amount, dispute.currency)}</strong>
          </div>
        ))}
        {disputes.length > 4 && (
          <div>And {disputes.length - 4} more selected disputes</div>
        )}
      </div>
      <label className="field-label" htmlFor="bulk-status">
        New status
      </label>
      <Select
        id="bulk-status"
        className="full-select"
        disabled={busy}
        value={status}
        onChange={(e) => setStatus(e.target.value as Status)}
      >
        {statuses.map((value) => (
          <option key={value} value={value}>
            {statusLabels[value]}
          </option>
        ))}
      </Select>
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      <div className="modal-actions">
        <button className="button secondary" disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <button
          className="button primary"
          disabled={busy}
          onClick={() => void submit()}
        >
          {busy ? "Applying…" : "Apply status change"}
          <ArrowRight size={14} />
        </button>
      </div>
    </Modal>
  );
}
