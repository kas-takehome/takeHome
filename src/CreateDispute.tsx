import { useState, type FormEvent } from "react";
import { Plus, X } from "lucide-react";
import {
  currencies,
  reasonLabels,
  reasons,
  type CreateDisputeInput,
  type DisputeDetail,
  type Reason,
} from "../shared/domain";
import { api } from "./api";
import { Select } from "./components";
import Modal from "./Modal";

function localDateTime() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}

export default function CreateDispute({
  agentOptions,
  onClose,
  onSuccess,
}: {
  agentOptions: string[];
  onClose: () => void;
  onSuccess: (id: string) => void;
}) {
  const [form, setForm] = useState(() => ({
    transaction_id: "",
    customer_id: "",
    customer_name: "",
    amount: "",
    currency: "USD",
    reason_code: "",
    date_received: localDateTime(),
    network_deadline: "",
    assigned_agent: "",
    notes: "",
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  function setField(field: keyof typeof form, value: string) {
    setForm((previous) => ({ ...previous, [field]: value }));
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError("");
    if (!/^(?:\d+|\d*\.\d{1,2})$/.test(form.amount)) {
      setError("Enter an amount with no more than two decimal places.");
      return;
    }
    const [whole, fraction = ""] = form.amount.split(".");
    setBusy(true);
    try {
      const input: CreateDisputeInput = {
        ...form,
        amount: Number(whole) * 100 + Number(fraction.padEnd(2, "0")),
        reason_code: form.reason_code as Reason,
        date_received: new Date(form.date_received).toISOString(),
        network_deadline: new Date(form.network_deadline).toISOString(),
        assigned_agent: form.assigned_agent || null,
      };
      const result = await api<DisputeDetail>("/disputes", {
        method: "POST",
        body: JSON.stringify(input),
      });
      onSuccess(result.dispute.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to add dispute.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      className="guide-modal create-modal"
      labelledBy="create-title"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <button
        className="icon-button modal-close"
        aria-label="Cancel new dispute"
        disabled={busy}
        onClick={onClose}
      >
        <X size={18} />
      </button>
      <h2 id="create-title">Add dispute</h2>
      <p>
        Create a case with status New. Its ID and mock risk score are generated
        automatically. Use synthetic data only.
      </p>
      <form onSubmit={(event) => void submit(event)}>
        <fieldset className="create-fields" disabled={busy}>
          {(
            [
              ["customer_name", "Customer name", "Taylor Example"],
              ["customer_id", "Customer ID", "cus_example"],
              ["transaction_id", "Transaction ID", "txn_example"],
            ] as const
          ).map(([field, label, placeholder]) => (
            <div key={field}>
              <label className="field-label" htmlFor={`create-${field}`}>
                {label}
              </label>
              <input
                className="text-input"
                id={`create-${field}`}
                value={form[field]}
                onChange={(event) => setField(field, event.target.value)}
                placeholder={placeholder}
                maxLength={120}
                pattern={
                  field === "customer_name" ? undefined : "[A-Za-z0-9_\\-]+"
                }
                title={
                  field === "customer_name"
                    ? undefined
                    : "Use letters, numbers, underscores or hyphens."
                }
                required
              />
            </div>
          ))}
          <div>
            <label className="field-label" htmlFor="create-reason">
              Reason
            </label>
            <Select
              className="full-select"
              id="create-reason"
              value={form.reason_code}
              onChange={(event) => setField("reason_code", event.target.value)}
              required
            >
              <option value="" disabled>
                Choose a reason
              </option>
              {reasons.map((reason) => (
                <option key={reason} value={reason}>
                  {reasonLabels[reason]}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label className="field-label" htmlFor="create-amount">
              Amount
            </label>
            <input
              className="text-input"
              id="create-amount"
              type="number"
              inputMode="decimal"
              min="0.01"
              max="9999999.99"
              step="0.01"
              value={form.amount}
              onChange={(event) => setField("amount", event.target.value)}
              placeholder="125.00"
              required
            />
          </div>
          <div>
            <label className="field-label" htmlFor="create-currency">
              Currency
            </label>
            <Select
              className="full-select"
              id="create-currency"
              value={form.currency}
              onChange={(event) => setField("currency", event.target.value)}
            >
              {currencies.map((currency) => (
                <option key={currency} value={currency}>
                  {currency}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label className="field-label" htmlFor="create-received">
              Date received
            </label>
            <input
              className="text-input"
              id="create-received"
              type="datetime-local"
              value={form.date_received}
              onChange={(event) =>
                setField("date_received", event.target.value)
              }
              required
            />
          </div>
          <div>
            <label className="field-label" htmlFor="create-deadline">
              Network deadline
            </label>
            <input
              className="text-input"
              id="create-deadline"
              type="datetime-local"
              min={form.date_received}
              value={form.network_deadline}
              onChange={(event) =>
                setField("network_deadline", event.target.value)
              }
              required
            />
          </div>
          <p className="create-wide field-hint">
            Dates use your local timezone and are stored in UTC. The deadline
            must be on or after the received date; overdue cases are allowed.
          </p>
          <div className="create-wide">
            <label className="field-label" htmlFor="create-agent">
              Assigned agent (optional)
            </label>
            <Select
              className="full-select"
              id="create-agent"
              value={form.assigned_agent}
              onChange={(event) =>
                setField("assigned_agent", event.target.value)
              }
            >
              <option value="">Unassigned (no agent)</option>
              {agentOptions.map((agent) => (
                <option key={agent} value={agent}>
                  {agent}
                </option>
              ))}
            </Select>
          </div>
          <div className="create-wide">
            <label className="field-label" htmlFor="create-notes">
              Initial note (optional)
            </label>
            <textarea
              id="create-notes"
              value={form.notes}
              onChange={(event) => setField("notes", event.target.value)}
              maxLength={4000}
              rows={3}
              aria-describedby="create-sensitive-warning"
              placeholder="Add context or next steps…"
            />
            <p className="field-hint" id="create-sensitive-warning">
              Never include card numbers, security codes, or real customer data.
            </p>
          </div>
        </fieldset>
        {error && (
          <div className="error-banner" role="alert">
            {error}
          </div>
        )}
        <div className="modal-actions">
          <button
            className="button secondary"
            type="button"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button className="button primary" type="submit" disabled={busy}>
            <Plus size={14} />
            {busy ? "Adding…" : "Add dispute"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
