import { useEffect, useState, type FormEvent } from "react";
import { Plus, X } from "lucide-react";
import {
  currencies,
  reasonLabels,
  reasons,
  type CreateDisputeInput,
  type Customer,
  type DisputeDetail,
  type Reason,
} from "../shared/domain";
import { api } from "./api";
import { Select } from "./components";
import Modal from "./Modal";
import CustomerPicker from "./CustomerPicker";

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
    customer_id: "",
    amount: "",
    currency: "USD",
    reason_code: "",
    assigned_agent: "",
    notes: "",
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [customerError, setCustomerError] = useState("");
  const [customerRevision, setCustomerRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void api<{ customers: Customer[] }>("/customers", {
      signal: controller.signal,
    })
      .then((result) => {
        if (!controller.signal.aborted) setCustomers(result.customers);
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted)
          setCustomerError(
            err instanceof Error ? err.message : "Unable to load customers.",
          );
      });
    return () => controller.abort();
  }, [customerRevision]);
  function setField(field: keyof typeof form, value: string) {
    setForm((previous) => ({ ...previous, [field]: value }));
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !customers?.length) return;
    setError("");
    if (
      !customers.some(
        (customer) => String(customer.customer_id) === form.customer_id,
      )
    ) {
      setError("Choose an existing customer from the suggestions.");
      return;
    }
    if (!/^(?:\d+|\d*\.\d{1,2})$/.test(form.amount)) {
      setError("Enter an amount with no more than two decimal places.");
      return;
    }
    const [whole, fraction = ""] = form.amount.split(".");
    setBusy(true);
    try {
      const input: CreateDisputeInput = {
        ...form,
        customer_id: Number(form.customer_id),
        amount: Number(whole) * 100 + Number(fraction.padEnd(2, "0")),
        reason_code: form.reason_code as Reason,
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
        Select an existing synthetic customer. The transaction ID and received
        time are generated when you add the case; the deadline is seven days
        later.
      </p>
      <form onSubmit={(event) => void submit(event)}>
        {customerError && (
          <div className="error-banner" role="alert">
            <span>Unable to load customers. {customerError}</span>
            <button
              type="button"
              onClick={() => {
                setCustomerError("");
                setCustomerRevision((value) => value + 1);
              }}
            >
              Retry
            </button>
          </div>
        )}
        {customers?.length === 0 && (
          <p role="status">
            No customers available. Add a customer to the database before
            creating a dispute.
          </p>
        )}
        <fieldset className="create-fields" disabled={busy}>
          <div className="create-wide">
            <label className="field-label" htmlFor="create-customer">
              Customer
            </label>
            <CustomerPicker
              id="create-customer"
              customers={customers ?? []}
              value={form.customer_id}
              onChange={(value) => setField("customer_id", value)}
              disabled={busy || !customers?.length}
              loading={customers === null && !customerError}
              placeholder={
                customerError
                  ? "Customers unavailable"
                  : customers === null
                    ? "Loading customers…"
                    : "Search customers by name or ID…"
              }
            />
          </div>
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
          <button
            className="button primary"
            type="submit"
            disabled={busy || !customers?.length}
          >
            <Plus size={14} />
            {busy ? "Adding…" : "Add dispute"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
