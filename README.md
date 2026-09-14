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

- Search by customer name or transaction ID; combine status, reason, agent, and urgency filters. Click deadline, amount, or status headings to toggle sorting. Clear filters to return to all disputes.
- Click a dispute to open its details. Change status, assign a listed/custom agent, or add a plain-text note; each actual change creates an audit event. The linked transactions and risk signals are explicitly mock data.
- Select rows across pages, choose **Change status**, and confirm. The entire batch fails if any selected record has changed, so refresh and reselect after a conflict. Already-matching statuses are reported as unchanged.
- Red = overdue or under 48 hours; yellow = 48 hours through 5 days inclusive; green = over 5 days. All deadlines are UTC timestamps, displayed in the browser's local timezone. SLA indicators remain visible on resolved disputes for historical context.
- “Due in 48h” counts future deadlines under 48 hours for `new`, `investigating`, and `evidence_submitted`. Overdue active cases have a separate counter. Exactly 48 hours belongs to the yellow group.
- Amount at risk sums **every non-closed dispute**, including won/lost/auto-resolved cases, per the requested definition. Currency totals are kept separate; no FX conversion is implied.
- Summary cards always show global totals; clicking a card filters the queue. Totals refresh after mutations and once per minute while the queue is idle. Automatic refresh pauses during selection and detail/bulk work to avoid disrupting edits.

## Data model and code map

`server/database.ts` creates the schema and seed data transactionally.

| Table            | Fields                                                                                                                                                                                                                              |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `disputes`       | `id`, `transaction_id` (unique), `customer_id`, `customer_name`, `amount`, `currency`, `reason_code`, `status`, `date_received`, `network_deadline`, `assigned_agent` (nullable), `risk_score`, `notes`, `created_at`, `updated_at` |
| `dispute_events` | `id`, `dispute_id` (foreign key), `event_type`, `actor`, `detail`, `created_at`                                                                                                                                                     |

Amounts are **integer minor units** (USD cents in the seed). Statuses: `new`, `investigating`, `evidence_submitted`, `won`, `lost`, `auto_resolved`, `closed`. Reasons: `fraud`, `duplicate`, `product_not_received`, `product_not_as_described`, `subscription_cancelled`, `other`. Event types: `status_change`, `note_added`, `assigned`, `evidence_submitted`. Enum constraints, foreign keys, and a 0–100 risk constraint protect stored values.

- `shared/domain.ts`: shared types, enum labels, and SLA calculations.
- `server/app.ts`: API validation, queue queries, rate limits, and error handling.
- `server/disputes.ts`: transactional mutations, timeline events, mock detail data, summary aggregation.
- `server/security.ts`: trusted actor/permission extension point and input/request protections.
- `src/App.tsx`, `src/Detail.tsx`, `src/BulkAction.tsx`: queue, detail, and bulk flows.
- `src/SummaryCards.tsx`, `src/api.ts`: global metrics and central API client.

API: `GET /api/disputes`, `GET /api/disputes/:id`, `GET /api/summary`, `PATCH /api/disputes/:id`, `POST /api/disputes/:id/notes`, `POST /api/disputes/bulk-status`. Writes require JSON and `X-Dispute-Client: internal-web`; patches and each bulk item require `expected_updated_at`. These request guards **are not authentication**. A note append is transactional and does not overwrite existing notes.

For Postgres, retain the logical tables and constraints, use `timestamptz`/UUID types as appropriate, replace `better-sqlite3` and `?` placeholders, add versioned migrations, and preserve event immutability. Use row locking or conditional `UPDATE ... WHERE updated_at = ...` with affected-row checks for concurrency; SQLite's serialized writes must not be assumed in Postgres. Move queue pagination/filtering and aggregation fully into SQL as volume grows.

## Security review and verification

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm audit
```

CI repeats these checks. Tests use isolated in-memory databases; they never touch your local dataset.

| Feature boundary  | Protections implemented and tested                                                                                                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Queue/read API    | Parameterized search/filter values, escaped LIKE wildcards, allowlisted sort fields, strict query validation, read permission checks, no-store responses.                                                    |
| Detail/write API  | Server-derived actor, strict body schemas, immutable ID/amount fields, plain-text notes, sensitive-pattern rejection, optimistic concurrency, atomic state/event writes.                                     |
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
