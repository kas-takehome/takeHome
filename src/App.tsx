import { useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
  ArrowUpRight,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Command,
  Inbox,
  Layers,
  LayoutGrid,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from "lucide-react";
import {
  agents,
  reasonLabels,
  reasons,
  statusLabels,
  statuses,
  type Dispute,
  type QueueResponse,
  type Summary,
} from "../shared/domain";
import { api } from "./api";
import { Select, StatusBadge, UrgencyBadge } from "./components";
import { date, initials, money } from "./format";
import Detail from "./Detail";
import CreateDispute from "./CreateDispute";
import Modal from "./Modal";
import BulkAction from "./BulkAction";
import SummaryCards, { type SummaryFilter } from "./SummaryCards";

export default function App() {
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [reason, setReason] = useState("");
  const [agent, setAgent] = useState("");
  const [agentOptions, setAgentOptions] = useState(agents);
  const [urgency, setUrgency] = useState("");
  const [scope, setScope] = useState("");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [summaryError, setSummaryError] = useState("");
  const [sort, setSort] = useState("network_deadline");
  const [order, setOrder] = useState("asc");
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [guide, setGuide] = useState(false);
  const [detailId, setDetailId] = useState(() => window.location.hash.slice(1));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [notification, setNotification] = useState("");
  const pageSize = 12;
  const filtersActive = Boolean(
    search || status || reason || agent || urgency || scope,
  );
  useEffect(() => {
    const syncHash = () => setDetailId(window.location.hash.slice(1));
    window.addEventListener("hashchange", syncHash);
    return () => window.removeEventListener("hashchange", syncHash);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    api<Summary>("/summary", { signal: controller.signal })
      .then((data) => {
        setSummary(data);
        setSummaryError("");
      })
      .catch((err: Error) => {
        if (err.name !== "AbortError") setSummaryError(err.message);
      });
    return () => controller.abort();
  }, [revision]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!detailId && !bulkOpen && !createOpen && selected.size === 0)
        setRevision((value) => value + 1);
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [detailId, bulkOpen, createOpen, selected.size]);
  useEffect(() => {
    setPage(1);
  }, [search, status, reason, agent, urgency, scope, sort, order]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setSelected(new Set());
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ sort, order });
      for (const [key, value] of Object.entries({
        search,
        status,
        reason,
        urgency,
        scope,
      }))
        if (value) params.set(key, value);
      if (agent === "unassigned") params.set("assignment", "unassigned");
      else if (agent.startsWith("name:")) {
        params.set("agent", agent.slice(5));
        params.set("assignment", "assigned");
      }
      api<QueueResponse>(`/disputes?${params}`, { signal: controller.signal })
        .then((data) => {
          if (controller.signal.aborted) return;
          setDisputes(data.disputes);
          setAgentOptions(data.agents);
          setError("");
          setPage((previous) =>
            Math.min(
              previous,
              Math.max(1, Math.ceil(data.disputes.length / pageSize)),
            ),
          );
        })
        .catch((err: Error) => {
          if (!controller.signal.aborted) {
            setDisputes([]);
            setError(err.message);
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [search, status, reason, agent, urgency, scope, sort, order, revision]);

  function changeSort(value: string) {
    setSort(value);
    setOrder(sort === value && order === "asc" ? "desc" : "asc");
  }
  function clearFilters() {
    setSearch("");
    setStatus("");
    setReason("");
    setAgent("");
    setUrgency("");
    setScope("");
  }
  function summaryFilter(filter: SummaryFilter) {
    clearFilters();
    setStatus(filter.status || "");
    setUrgency(filter.urgency || "");
    setScope(filter.scope || "");
  }
  const SortIcon = ({ field }: { field: string }) =>
    sort === field ? (
      order === "asc" ? (
        <ArrowUp size={12} />
      ) : (
        <ArrowDown size={12} />
      )
    ) : (
      <ArrowUpDown size={12} />
    );
  const visible =
    loading || error
      ? []
      : disputes.slice((page - 1) * pageSize, page * pageSize);
  const filterAgents = agent.startsWith("name:")
    ? [...new Set([...agentOptions, agent.slice(5)])]
    : agentOptions;
  const allPageSelected =
    visible.length > 0 && visible.every((dispute) => selected.has(dispute.id));
  function toggleSelection(id: string) {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/">
          <span className="brand-icon">
            <Command size={20} />
          </span>
          <span>
            Dispute<span className="brand-light">Triage</span>
          </span>
        </a>
        <div className="workspace-card">
          <span className="workspace-avatar">O</span>
          <div>
            <strong>Operations workspace</strong>
            <span>Internal tools</span>
          </div>
          <ChevronRight size={14} />
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          <button
            className="nav-item active"
            onClick={() => {
              clearFilters();
              setPage(1);
            }}
          >
            <Inbox size={17} />
            Dispute queue
            <span className="nav-count">{summary?.total ?? "—"}</span>
          </button>
        </nav>
        <div className="nav-label resources-label">RESOURCES</div>
        <button className="nav-item" onClick={() => setGuide(true)}>
          <BookOpen size={17} />
          SLA guidelines
          <ArrowUpRight size={13} className="nav-tail" />
        </button>
        <div className="sidebar-bottom">
          <div className="demo-notice">
            <ShieldCheck size={17} />
            <div>
              <strong>Sandbox workspace</strong>
              <p>
                Synthetic data only.
                <br />
                Built for internal operations.
              </p>
            </div>
          </div>
          <div className="operator">
            <span className="operator-avatar">LO</span>
            <div>
              <strong>Local operator</strong>
              <span>Support & operations</span>
            </div>
            <span className="online-dot" />
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumbs">
            <LayoutGrid size={15} />
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>Dispute queue</strong>
          </div>
          <div className="topbar-right">
            <span className="environment">
              <span />
              Demo environment
            </span>
            <span className="topbar-divider" />
            <button
              className="icon-button"
              aria-label="Open SLA guidelines"
              onClick={() => setGuide(true)}
            >
              <CircleHelp size={18} />
            </button>
            <span className="small-avatar">LO</span>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">DISPUTE OPERATIONS</div>
              <h1>Dispute queue</h1>
              <p>Every dispute, one workspace. Stay ahead of your deadlines.</p>
            </div>
            <div className="page-actions">
              <button
                className="button secondary"
                onClick={() => setRevision((value) => value + 1)}
                disabled={loading}
              >
                <RefreshCw size={14} className={loading ? "spin" : ""} />
                Refresh
              </button>
              <button
                className="button primary"
                onClick={() => setCreateOpen(true)}
              >
                <Plus size={14} />
                Add dispute
              </button>
            </div>
          </div>
          <SummaryCards
            summary={summary}
            onFilter={summaryFilter}
            status={status}
          />
          {summaryError && (
            <div className="error-banner" role="alert">
              Summary unavailable: {summaryError}
              <button onClick={() => setRevision((value) => value + 1)}>
                Retry
              </button>
            </div>
          )}
          <section className="queue-section">
            <div className="queue-tabs">
              <div className="tab active">
                {filtersActive ? "Filtered disputes" : "All disputes"}{" "}
                <span>{loading || error ? "—" : disputes.length}</span>
              </div>
              <div className="queue-meta">
                <span className="live-dot" />
                {loading
                  ? "Updating queue…"
                  : error
                    ? "Queue unavailable"
                    : "SQLite · live data"}
              </div>
            </div>
            <div className="filter-toolbar">
              <div className="search-field">
                <Search size={16} />
                <input
                  aria-label="Search disputes"
                  placeholder="Search customer or transaction ID..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                {search && (
                  <button
                    aria-label="Clear search"
                    onClick={() => setSearch("")}
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
              <div className="filters">
                <SlidersHorizontal size={15} className="filter-icon" />
                <Select
                  aria-label="Filter by status"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  <option value="">All statuses</option>
                  {statuses.map((value) => (
                    <option key={value} value={value}>
                      {statusLabels[value]}
                    </option>
                  ))}
                </Select>
                <Select
                  aria-label="Filter by reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                >
                  <option value="">All reasons</option>
                  {reasons.map((value) => (
                    <option key={value} value={value}>
                      {reasonLabels[value]}
                    </option>
                  ))}
                </Select>
                <Select
                  aria-label="Filter by agent"
                  value={agent}
                  onChange={(e) => setAgent(e.target.value)}
                >
                  <option value="">All agents</option>
                  <option value="unassigned">Unassigned (no agent)</option>
                  {filterAgents.map((value) => (
                    <option key={value} value={`name:${value}`}>
                      {value}
                    </option>
                  ))}
                </Select>
                <Select
                  aria-label="Filter by urgency"
                  value={urgency}
                  onChange={(e) => setUrgency(e.target.value)}
                >
                  <option value="">All urgency</option>
                  <option value="overdue">Overdue</option>
                  <option value="urgent">Urgent · &lt;48 hours</option>
                  <option value="upcoming">Due in 2–5 days</option>
                  <option value="on_track">On track · &gt;5 days</option>
                </Select>
              </div>
            </div>
            {filtersActive && (
              <div className="filter-summary">
                {loading
                  ? "Updating queue…"
                  : error
                    ? "Results unavailable"
                    : `${disputes.length} matching disputes`}
                {scope &&
                  ` · ${scope === "active" ? "Active cases only" : "Excluding closed"}`}
                <button onClick={clearFilters}>
                  Clear filters <X size={12} />
                </button>
              </div>
            )}
            {error && (
              <div role="alert" className="error-banner">
                {error}
                <button onClick={() => setRevision((v) => v + 1)}>Retry</button>
              </div>
            )}
            {notification && (
              <div className="notification" role="status">
                {notification}
                <button
                  className="icon-button"
                  onClick={() => setNotification("")}
                  aria-label="Dismiss notification"
                >
                  <X size={13} />
                </button>
              </div>
            )}
            {selected.size > 0 && (
              <div className="bulk-toolbar">
                <span>
                  <Layers size={14} />
                  <strong>{selected.size} selected</strong>
                  <span>across all pages</span>
                </span>
                <div>
                  <button
                    className="button secondary"
                    onClick={() => setSelected(new Set())}
                  >
                    Clear selection
                  </button>
                  <button
                    className="button primary"
                    onClick={() => setBulkOpen(true)}
                  >
                    Change status
                    <ArrowRight size={13} />
                  </button>
                </div>
              </div>
            )}
            <div className="table-scroll" aria-busy={loading}>
              <table>
                <thead>
                  <tr>
                    <th className="checkbox-cell">
                      <input
                        type="checkbox"
                        aria-label="Select all disputes on this page"
                        disabled={loading || !visible.length}
                        checked={allPageSelected}
                        ref={(element) => {
                          if (element)
                            element.indeterminate =
                              !allPageSelected &&
                              visible.some((dispute) =>
                                selected.has(dispute.id),
                              );
                        }}
                        onChange={() =>
                          setSelected((previous) => {
                            const next = new Set(previous);
                            for (const dispute of visible) {
                              if (allPageSelected) next.delete(dispute.id);
                              else next.add(dispute.id);
                            }
                            return next;
                          })
                        }
                      />
                    </th>
                    <th className="customer-column">Customer / transaction</th>
                    <th>
                      <button onClick={() => changeSort("amount")}>
                        Amount <SortIcon field="amount" />
                      </button>
                    </th>
                    <th>Reason</th>
                    <th>
                      <button onClick={() => changeSort("status")}>
                        Status <SortIcon field="status" />
                      </button>
                    </th>
                    <th>
                      <button onClick={() => changeSort("network_deadline")}>
                        Deadline <SortIcon field="network_deadline" />
                      </button>
                    </th>
                    <th>Assigned to</th>
                    <th className="row-arrow" />
                  </tr>
                </thead>
                <tbody>
                  {visible.map((dispute) => (
                    <tr
                      key={dispute.id}
                      className={selected.has(dispute.id) ? "row-selected" : ""}
                      onClick={() => {
                        window.location.hash = dispute.id;
                      }}
                    >
                      <td
                        className="checkbox-cell"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          aria-label={`Select ${dispute.id}`}
                          disabled={loading}
                          checked={selected.has(dispute.id)}
                          onChange={() => toggleSelection(dispute.id)}
                        />
                      </td>
                      <td>
                        <div className="customer-cell">
                          <span
                            className={`customer-avatar avatar-${dispute.customer_name.length % 5}`}
                          >
                            {initials(dispute.customer_name)}
                          </span>
                          <div>
                            <a href={`#${dispute.id}`} className="row-link">
                              <strong>{dispute.customer_name}</strong>
                            </a>
                            <span className="mono">
                              {dispute.transaction_id}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className="amount">
                          {money(dispute.amount, dispute.currency)}
                        </span>
                        <span className="currency">{dispute.currency}</span>
                      </td>
                      <td>
                        <span className="reason-text">
                          {reasonLabels[dispute.reason_code]}
                        </span>
                      </td>
                      <td>
                        <StatusBadge status={dispute.status} />
                      </td>
                      <td>
                        <div className="deadline-cell">
                          <span>{date(dispute.network_deadline)}</span>
                          <UrgencyBadge deadline={dispute.network_deadline} />
                        </div>
                      </td>
                      <td>
                        {dispute.assigned_agent ? (
                          <div className="agent-cell">
                            <span className="agent-avatar">
                              {initials(dispute.assigned_agent)}
                            </span>
                            {dispute.assigned_agent.split(" ")[0]}{" "}
                            {dispute.assigned_agent.split(" ")[1]?.[0]}.
                          </div>
                        ) : (
                          <span className="unassigned">— Unassigned</span>
                        )}
                      </td>
                      <td className="row-arrow">
                        <ChevronRight size={15} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!loading && !error && !visible.length && (
                <div className="empty-state">
                  <Search size={26} />
                  <h3>No disputes found</h3>
                  <p>Try a different search or adjust your filters.</p>
                  <button className="button secondary" onClick={clearFilters}>
                    Clear filters
                  </button>
                </div>
              )}
              {loading && (
                <div className="empty-state">
                  <RefreshCw className="spin" size={24} />
                  <p>Loading your queue…</p>
                </div>
              )}
            </div>
            <div className="table-footer">
              <span>
                {loading
                  ? "Updating queue…"
                  : error
                    ? "Results unavailable"
                    : disputes.length
                      ? `Showing ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, disputes.length)} of ${disputes.length} disputes`
                      : "0 disputes"}
              </span>
              <div className="pagination">
                {!loading && !error && (
                  <span>
                    Page {page} of{" "}
                    {Math.max(1, Math.ceil(disputes.length / pageSize))}
                  </span>
                )}
                <button
                  className="icon-button"
                  aria-label="Previous page"
                  disabled={loading || !!error || page === 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  <ChevronLeft size={15} />
                </button>
                <button
                  className="icon-button"
                  aria-label="Next page"
                  disabled={
                    loading || !!error || page * pageSize >= disputes.length
                  }
                  onClick={() => setPage((p) => p + 1)}
                >
                  <ChevronRight size={15} />
                </button>
              </div>
            </div>
          </section>
          <footer className="page-footer">
            <span>
              <ShieldCheck size={13} />
              Internal workspace · All changes are audit logged
            </span>
            <button onClick={() => setGuide(true)}>
              <span className="legend-dot red" />
              &lt;2 days
              <span className="legend-dot yellow" />
              2–5 days
              <span className="legend-dot green" />
              &gt;5 days
              <CircleHelp size={12} />
            </button>
          </footer>
        </main>
      </div>
      {createOpen && (
        <CreateDispute
          agentOptions={agentOptions}
          onClose={() => setCreateOpen(false)}
          onSuccess={(id) => {
            setCreateOpen(false);
            clearFilters();
            setPage(1);
            setRevision((value) => value + 1);
            setNotification(`${id} created. Changes audit logged.`);
            window.location.hash = id;
          }}
        />
      )}
      {detailId && (
        <Detail
          key={detailId}
          id={detailId}
          agentOptions={agentOptions}
          onClose={() => {
            window.location.hash = "";
          }}
          onChange={() => setRevision((value) => value + 1)}
        />
      )}
      {bulkOpen && (
        <BulkAction
          disputes={disputes.filter((dispute) => selected.has(dispute.id))}
          onClose={() => setBulkOpen(false)}
          onSuccess={(message) => {
            setNotification(message);
            setBulkOpen(false);
            setRevision((value) => value + 1);
          }}
        />
      )}
      {guide && (
        <Modal
          className="guide-modal"
          labelledBy="guide-title"
          onClose={() => setGuide(false)}
        >
          <button
            className="icon-button modal-close"
            onClick={() => setGuide(false)}
            aria-label="Close guidelines"
          >
            <X size={18} />
          </button>
          <div className="eyebrow">OPERATIONS HANDBOOK</div>
          <h2 id="guide-title">A deadline should never be a surprise.</h2>
          <p>
            Network deadlines use UTC and remain visible for all disputes,
            including resolved cases.
          </p>
          <div className="guide-line">
            <span className="legend-dot red" />
            <div>
              <strong>Urgent · less than 48 hours</strong>
              <p>
                Prioritize these cases. Overdue disputes are shown in red with
                time past due.
              </p>
            </div>
          </div>
          <div className="guide-line">
            <span className="legend-dot yellow" />
            <div>
              <strong>Upcoming · 2 to 5 days</strong>
              <p>
                Gather evidence and confirm ownership before the deadline
                approaches.
              </p>
            </div>
          </div>
          <div className="guide-line">
            <span className="legend-dot green" />
            <div>
              <strong>On track · more than 5 days</strong>
              <p>
                Review the details and assign an agent to keep the case moving.
              </p>
            </div>
          </div>
          <div className="notice">
            Sandbox only. Do not enter card numbers, CVVs, bank details, or real
            customer information.
          </div>
          <button className="button primary" onClick={() => setGuide(false)}>
            Got it
          </button>
        </Modal>
      )}
    </div>
  );
}
