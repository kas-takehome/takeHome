# Dispute Triage

An internal chargeback queue for support and operations: React + TypeScript + Tailwind CSS, an Express API, and SQLite. Includes 48 synthetic disputes, SLA indicators, filters/search/sorting, a detail drawer, agent assignment, notes, audit history, atomic bulk status updates, and dashboard totals.

**Local demo only. No authentication is enabled. Use synthetic data; never enter real customer data, card numbers, CVV/CVC, PINs, or credentials.**

## Run locally

Use **Node.js 22.12 or later** (Node 22 LTS recommended; `nvm use` uses `.nvmrc`), then:

```sh
npm install && npm run dev
```

Open **http://127.0.0.1:5173**. Vite proxies `/api` to Express at **http://127.0.0.1:3001**. Both bind to loopback by default. SQLite creates and seeds `data/disputes.sqlite` on first startup; edits persist across restarts. No external services or secrets are required. `better-sqlite3` uses a native addon: if a prebuilt binary isn't available for your OS/Node version, install your platform's C++ build tools and Python.

To serve the compiled frontend from Express:

```sh
npm run build && npm start
```

Open **http://127.0.0.1:3001**. This is a local build preview, not a secure production deployment. Keep development dependencies installed: the server runs with `tsx`.

Optional environment variables:

| Variable        | Purpose                                                                                               |
| --------------- | ----------------------------------------------------------------------------------------------------- |
| `DATABASE_PATH` | Alternate SQLite path; an empty database seeds automatically.                                         |
| `PORT`          | Express port (default 3001); also update the Vite proxy if using a different port in development.     |
| `APP_ORIGIN`    | Exact permitted mutation origin, e.g. `http://127.0.0.1:5173`; also permits this hostname at Express. |
| `DEV_HOST`      | Override Vite's loopback binding for a trusted demo preview. Never expose it with real data.          |

Shell environment variables are used directly; the server does not automatically load `.env` files. For a fresh synthetic dataset, stop the server and choose a new `DATABASE_PATH` rather than overwriting an existing database.

## Workflow and SLA definitions

- Click **Add dispute** to the right of **Refresh**. Select an existing synthetic customer (name and integer ID), then enter the amount, currency and reason. Optionally select an existing agent and add a note. Successful creation refreshes the queue and totals, clears filters, and opens the new case; errors retain the form for correction. Customer loading failures offer a retry and prevent submission.
- New disputes start in `new` status with a generated `DSP-…` ID, a unique increasing integer transaction ID and deterministic mock risk score. The server sets receipt to its current time at submission and the network deadline to exactly seven days (168 hours) later. These fields are not editable in the form. Dates are stored in UTC and displayed in the browser's local timezone. Creation supports USD, EUR, GBP, CAD and AUD, with amounts from 0.01 to 9,999,999.99 in the selected currency.
- Search by customer name or transaction ID; combine status, reason, agent, and urgency filters. Click deadline, amount, or status headings to toggle sorting. Clear filters to return to all disputes.
- Agent options include every current custom assignment plus the four predefined agents, independently of other filters. “Unassigned (no agent)” is distinct from an agent named `unassigned`. Failed queue requests hide rows/counts until a successful retry.
- Click a dispute to open its details. Change status, choose an existing agent from the assignment dropdown (or “Unassigned (no agent)”), or add a plain-text note; each actual change creates an audit event. Agent choices include the four predefined agents and names already assigned to disputes. Click **Save assignment** to apply the selection. The linked transactions and risk signals are explicitly mock data.
- Select rows across pages, choose **Change status**, and confirm. The entire batch fails if any selected record has changed, so refresh and reselect after a conflict. Already-matching statuses are reported as unchanged.
- Red = overdue or under 48 hours; yellow = 48 hours through 5 days inclusive; green = over 5 days. All deadlines are UTC timestamps, displayed in the browser's local timezone. SLA indicators remain visible on resolved disputes for historical context.
- “Due in 48h” counts future deadlines under 48 hours for `new`, `investigating`, and `evidence_submitted`. Overdue active cases have a separate counter. Exactly 48 hours belongs to the yellow group.
- Amount at risk sums **every non-closed dispute**, including won/lost/auto-resolved cases, per the requested definition. Currency totals are kept separate; no FX conversion is implied.
- Summary cards always show global totals; clicking a card filters the queue. Totals refresh after mutations and once per minute while the queue is idle. Automatic refresh pauses during selection and detail/bulk work to avoid disrupting edits.

## Data model and code map

`server/migrations.ts` maintains the versioned schema; `server/database.ts` seeds 48 synthetic customers and disputes on an empty database.

| Table            | Fields                                                                                                                                                                                                                              |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `customers`      | `customer_id` (integer primary key), `customer_name` (string) |
| `disputes`       | `id` (unique case ID), `transaction_id` (autoincrement integer primary key), `customer_id` (foreign key), `customer_name` (name snapshot), `amount`, `currency`, `reason_code`, `status`, `date_received`, `network_deadline`, `assigned_agent` (nullable), `risk_score`, `notes`, `created_at`, `updated_at` |
| `dispute_events` | `id`, `dispute_id` (foreign key), `event_type`, `actor`, `detail`, `created_at`                                                                                                                                                     |

Amounts are **integer minor units** (USD cents in the seed). Statuses: `new`, `investigating`, `evidence_submitted`, `won`, `lost`, `auto_resolved`, `closed`. Reasons: `fraud`, `duplicate`, `product_not_received`, `product_not_as_described`, `subscription_cancelled`, `other`. Event types: `status_change`, `note_added`, `assigned`, `evidence_submitted`. Enum constraints, foreign keys, and a 0–100 risk constraint protect stored values.

Customer records are separate from disputes: multiple disputes can reference one customer, and customers without disputes are selectable. The shared `Customer` model has `customer_id: number` and `customer_name: string`; creation takes only the existing ID and copies the name from the database. Customer administration is outside this UI.

On first startup with the old schema, migration version 1 converts legacy string customer IDs into stable integer IDs grouped by the old ID. Distinct IDs with the same name remain separate customers; the earliest case supplies the canonical customer name. Legacy transaction IDs are replaced with increasing integers ordered by case creation time and case ID. Existing case IDs, customer-name snapshots, amounts, statuses, dates, notes and audit events remain unchanged. The table rebuild and foreign-key check run atomically and roll back on failure; subsequent startups do not renumber anything. Back up an existing database before upgrading if you need its old identifiers. SQLite's `AUTOINCREMENT` sequence persists across restarts and does not reuse deleted transaction IDs.

- `shared/domain.ts`: shared types, enum labels, and SLA calculations.
- `server/app.ts`: API validation, queue queries, rate limits, and error handling.
- `server/disputes.ts`: transactional mutations, timeline events, mock detail data, summary aggregation.
- `server/security.ts`: trusted actor/permission extension point and input/request protections.
- `src/App.tsx`, `src/Detail.tsx`, `src/BulkAction.tsx`: queue, detail, and bulk flows.
- `src/SummaryCards.tsx`, `src/api.ts`: global metrics and central API client.

API: `GET /api/customers`, `GET /api/disputes`, `POST /api/disputes`, `GET /api/disputes/:id`, `GET /api/summary`, `PATCH /api/disputes/:id`, `POST /api/disputes/:id/notes`, `POST /api/disputes/bulk-status`. Writes require JSON and `X-Dispute-Client: internal-web`; patches and each bulk item require `expected_updated_at`. These request guards **are not authentication**. A note append is transactional and does not overwrite existing notes.

`GET /api/customers` returns `{ customers: [{ customer_id, customer_name }] }`, sorted by name and ID, with the same read permissions and no-store headers as disputes.

`POST /api/disputes` accepts positive integer `customer_id`, integer minor-unit `amount`, `currency`, `reason_code`, plus optional `assigned_agent` and `notes`. It returns `201` with the detail payload and a `Location` header. The server owns the customer name, transaction ID, receipt/deadline, case ID, status, risk and timestamps, and derives the actor from the trusted identity. Client-supplied values for those server-owned fields, unknown customers/agents and invalid/sensitive input return `400`. A SQLite immediate transaction allocates IDs and saves the case with its initial `status_change` creation event and optional assignment/note events; audit failure rolls back the case and transaction allocation too.

Queue responses include global `agents` filter options alongside the matching `disputes` and `total`. Use `assignment=assigned&agent=<name>` for a literal agent name or `assignment=unassigned` for null assignments; the original `agent=unassigned` shorthand is also accepted.

For Postgres, retain the logical tables and constraints, replace SQLite `AUTOINCREMENT` with identity columns/sequences, use `timestamptz`/UUID types as appropriate, replace `better-sqlite3` and `?` placeholders, port the versioned migrations, and preserve event immutability. Use row locking or conditional `UPDATE ... WHERE updated_at = ...` with affected-row checks for concurrency; SQLite's serialized writes must not be assumed in Postgres. Move queue pagination/filtering and aggregation fully into SQL as volume grows.

## Security review and verification

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm audit
```

CI repeats these checks. Tests use isolated in-memory databases and disposable files under the home directory for migration/restart checks; they never touch your local dataset.

| Feature boundary  | Protections implemented and tested                                                                                                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Queue/read API    | Parameterized search/filter values, escaped LIKE wildcards, allowlisted sort fields, strict query validation, read permission checks, no-store responses.                                                    |
| Detail/write API  | Server-derived actor, strict body schemas, immutable ID/amount fields, plain-text notes, sensitive-pattern rejection, optimistic concurrency, atomic state/event writes.                                     |
| Customer/creation API | Read/write permissions and guards, strict field allowlist, positive integer minor units, existing-customer/agent validation, generated IDs and SLA dates, and atomic creation/audit persistence. |
| Bulk API          | Unique IDs, bounded batch size, per-record version checks and audit events, full rollback on stale/missing records.                                                                                          |
| Summary           | Read permission checks, active-only upcoming/overdue counts, non-closed amount totals separated by currency.                                                                                                 |
| Transport/storage | Helmet/CSP headers, no CORS opt-in, same-site write guards, hostname restrictions, 16 KB body cap, 300 API requests/minute and 60 writes/minute per IP, generic error responses, append-only event triggers. |

The database directory is created with mode 0700 and the file with 0600; the server uses a restrictive umask for sidecar files. Existing parent directory permissions are not changed. Database/secret files are ignored by Git. Vite denies direct access to database, server, Git, certificate, and environment files; the compiled server only serves `dist`. Request bodies/customer data are not logged. React renders notes as escaped text; no HTML rendering or browser persistent storage is used.

**Limits:** This is not PCI DSS/SOC 2 certification, a penetration test, or an encrypted database. Sensitive-text checks are conservative heuristics, can reject benign numbers, and can miss obfuscated sensitive data. SQLite triggers cannot prevent a database owner from tampering. Dependencies must continue to be monitored even when `npm audit` is clean.

Before handling real financial data:

1. Replace `resolveActor` with a verified identity-provider session and derive stable actor IDs/permissions on the server. `createApp(db, identityMiddleware)` supports injecting this; all read/write routes already enforce permissions. Add tenant/record-level access checks, secure cookies/CSRF protection, and authorization tests for the real identity model.
2. Deploy behind an authenticated private gateway with TLS, an explicit `APP_ORIGIN`/host allowlist, correctly configured trusted proxies, shared rate limiting, and production CSP/HSTS policy. Enable CSP `upgrade-insecure-requests` when TLS is available; it is disabled for the HTTP local demo.
3. Use encrypted managed storage/backups and least-privilege database roles; keep secrets in a secret manager. Keep raw cardholder and sensitive authentication data entirely out of the app. Establish access reviews, retention/deletion rules, incident response, monitoring, and redaction/DLP.
4. Export audit events to a protected append-only destination using immutable actor IDs. Define evidence access and retention; remove the duplicated notes snapshot if retention rules require it.
5. Have security/compliance owners assess applicable PCI/privacy/regulatory scope and approve the deployment, controls, dependency policy, and operational procedures.

## Stripe integration extension

Replace the seed/mock boundary with a server-side Stripe adapter, leaving the React API contract stable. Keep a unique provider-dispute ID in addition to internal IDs; never expose provider credentials to the browser. Map provider amounts/currencies and reason/status values into `shared/domain.ts` (including minor-unit conventions), and map evidence deadlines to `network_deadline`.

Add a dedicated webhook route **before** the JSON parser using a raw body and verified Stripe signature; it needs provider signature authentication rather than the browser's internal-client header. Deduplicate webhook event IDs in a transaction, account for retries/out-of-order delivery, and atomically persist state plus an event via the service layer. Use least-privilege server credentials for fetching disputes and submitting evidence, plus retry/idempotency handling and secret rotation. Replace `getDetail`'s synthetic transactions/risk signals with authorized provider/internal-system lookups; store only the minimum metadata needed. No Stripe integration is active in this demo.
