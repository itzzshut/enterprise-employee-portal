# Architecture

How the Enterprise Employee Portal is put together, and why it is put together
that way. This document is about decisions and constraints; the README covers
what the product does and how to run it.

---

## 1. Shape of the system

Three tiers, deliberately boring:

```
Browser ──▶ nginx (Angular SPA, /api proxy) ──▶ Express API ──▶ MySQL 8
```

The SPA and the API are separate deployables with separate images, separate
health checks and separate scaling characteristics. They share nothing but the
HTTP contract described in `api/src/docs/openapi.ts` and exercised by the
Postman collection.

The API is stateless. Sessions live in signed JWTs plus a `refresh_tokens`
table, uploads go to a mounted volume (S3 in production), and nothing is kept
in process memory that a second replica would need. That is what makes the
blue/green deployment in `jenkins/scripts/deploy.sh` safe: two versions can
serve traffic simultaneously during the switchover.

---

## 2. Layering rules

### API

```
routes → middleware → controller → service → repository → knex → MySQL
```

Each layer has exactly one job, and the rules are enforced in review:

| Layer | Does | Must not |
| --- | --- | --- |
| `*.routes.ts` | Wire paths to middleware and controller | Contain logic |
| `middleware/` | Cross-cutting: auth, validation, rate limits, errors | Know about a domain |
| `*.controller.ts` | Translate HTTP ↔ service call, choose the status code | Contain business rules |
| `*.service.ts` | Business rules, authorisation on rows, transactions | Touch `req`/`res`, write SQL |
| `*.repository.ts` | Query building, mapping rows | Decide who may see a row |
| `*.schema.ts` | Zod shapes for body/query/params | Hit the database |

Two rules do most of the work:

**The controller never contains a business rule.** If a controller has an `if`
that is not about HTTP, it belongs in the service. This is what makes the
services unit-testable without Supertest — `leave.service.test.ts` mocks the
repository and tests the workflow directly.

**The repository never makes an authorisation decision.** A repository method
answers "give me the rows matching these filters". Whether the caller may see
those rows is a service question, because only the service knows the actor.
The one place this bends is the documents repository, where visibility is
pushed into the `WHERE` clause — otherwise the pagination totals would leak how
many documents the caller cannot see.

### Web

```
routes → guards → feature component → feature service → core services → interceptors → HTTP
```

| Layer | Does |
| --- | --- |
| `app.routes.ts` | Lazy route definitions, guards, titles |
| `core/guards` | Functional `CanActivateFn` — convenience, not security |
| `features/*` | Screens. Presentation, forms, local UI state |
| `features/*/x.service.ts` | Endpoint strings and payload shapes for one module |
| `core/services` | Session, tokens, HTTP wrapper, notifications |
| `core/interceptors` | Bearer token + refresh-with-queue, error → toast |
| `shared/*` | Presentational components, pipes, the `appHasRole` directive |

Components never call `HttpClient` directly and never build a URL. That
indirection is cheap and it means an endpoint rename touches one file.

---

## 3. State management, and why there is no store

The SPA uses Angular signals. There is no NgRx, no Akita, no `BehaviorSubject`
service layer pretending to be a store. That was a decision, not an omission.

What a store buys you is: a single source of truth for state shared between
distant components, time-travel debugging, and a disciplined way to model
async transitions. Weigh that against this application:

- **Shared state is one object.** The session (`AuthService.sessionUser`) is
  the only thing more than one screen reads. Everything else — a page of leave
  requests, a timesheet grid, a directory filter — belongs to a single screen
  and dies with it.
- **The server is the source of truth.** Leave balances change as a side effect
  of an approval performed by someone else. A client cache of that would be
  wrong within minutes, so screens refetch rather than reduce. A normalised
  client store would be a second, staler copy of the database.
- **Derivations are pure.** `isManager`, `isHrAdmin`, `displayName`,
  `requestedDays`, `exceedsBalance` are all `computed()` — the exact thing
  selectors exist for, with none of the wiring.
- **Async is already modelled.** HttpClient returns a cold observable per
  request; effects/epics would add a layer to re-express what the observable
  already says.

The cost is real and worth naming: no time-travel debugging, no global action
log, and a future feature with genuinely shared cross-screen state (a live
notification feed over WebSockets, say) would need discipline to avoid becoming
a pile of ad-hoc signals. The migration path is deliberate — feature services
already own all data access, so a store would slot in behind them without
touching a single component.

**Rules in force today**

1. One writable signal per concern; everything derived is `computed()`.
2. Signals are exposed `asReadonly()`; only the owning service mutates.
3. `toSignal` converts an observable at the edge (the request form does this
   with `form.valueChanges`), never in the middle of a pipeline.
4. Every subscription carries `takeUntilDestroyed`.

---

## 4. Auth and session design

### Tokens

| Token | Lifetime | Storage | Carries |
| --- | --- | --- | --- |
| Access | 15 minutes | `localStorage`, mirrored into a signal | `sub`, `role`, `employeeId`, `email` |
| Refresh | 7 days | `localStorage`; **SHA-256 digest** in `refresh_tokens` | `sub`, `jti` |

A short access token limits the damage of a leaked token without asking the
user to sign in every quarter of an hour. Passwords are bcrypt at 12 rounds
(configurable, floor of 10 enforced by the env schema).

### Rotation and reuse detection

Each refresh consumes exactly one row and issues a new one, recording
`replaced_by_jti`. If a token verifies cryptographically but has no live row,
it has already been used — the signature of a stolen token — so
`authService.refresh` revokes **every** session for that user and logs at
`error`. The Postman collection asserts this path explicitly.

### Why the extra database read on every request

`authenticate` verifies the JWT and then loads the user row. That is one
primary-key read per request, and it buys immediate revocation: without it a
deactivated account or a demoted role would stay valid for up to fifteen
minutes. On a portal where "revoke access now" is an actual HR requirement,
that trade is obvious.

### Two layers of authorisation

- `authorize(...roles)` — route level. "May this role call this endpoint at
  all?" Cheap, declarative, visible in the route file.
- Service-level checks — row level. "Is this employee one of my reports?"
  `employeesRepository.isInReportingLine` walks the management chain with a
  bounded recursive CTE.

Both are required. Route-level checks alone would let a manager approve another
team's leave; row-level checks alone would scatter role logic through services.
Ownership failures return **403, not 404**: the directory already tells every
employee that the record exists, so pretending otherwise adds nothing.

### Storage trade-off, stated plainly

`localStorage` is readable by any script on the origin. It is acceptable here
because the app ships a strict CSP with no inline scripts and no third-party
JavaScript. The stronger design — an `httpOnly` refresh cookie with the access
token held only in memory — is on the roadmap and would delete `TokenService`
entirely.

---

## 5. Database design

### Principles

1. **Migrations are the schema.** Nothing is created by hand or by an init SQL
   file; `docker/mysql/init` only prepares the database and the user. Local,
   staging and production share one ordered, reversible history.
2. **Constraints in the database, not only in the service.** Real foreign keys,
   unique indexes that encode workflow invariants (one approval per stage per
   request), and CHECK constraints on numeric ranges. A bug in a service should
   fail loudly, not corrupt data quietly.
3. **Delete behaviour is chosen per relationship.** `manager_id` is `RESTRICT`
   — deleting a manager must never orphan or cascade a subtree. `actor_user_id`
   on `audit_logs` is `SET NULL` — deleting a user must not erase the history
   of what they did. Child tables of an employee are `CASCADE`.

### Index choices

Every index in the migrations carries a comment explaining the query it serves.
The ones that matter:

| Index | Serves |
| --- | --- |
| `(employee_id, status)` on `leave_requests` | "My requests, filtered by status" — the most frequent query in the app, and the status facet counts come from the same index |
| `(employee_id, start_date, end_date)` | Overlap detection and the personal calendar: equality on the employee, then a range scan on the dates, in that order |
| `(current_approver_id, status)` | The approvals inbox: "everything waiting on me" |
| `(start_date, end_date, status)` | The company-wide calendar, which has no employee predicate |
| `(employee_id, leave_type_id, year)` UNIQUE | One balance row per type per year; it is also the exact lookup key for every read and adjustment |
| `(employee_id, week_start_date)` UNIQUE | Makes the weekly timesheet upsert idempotent instead of a read-then-write race |
| `(entity_type, entity_id, created_at)` | Audit: "what happened to this record", with the timestamp as the trailing range column |

The ordering rule throughout: equality columns first, range columns last.

### Concurrency

Leave submission is the one place two users can genuinely race — two requests
consuming the last remaining day. The service opens a transaction, takes
`SELECT … FOR UPDATE` on the balance row, then checks overlap, validates the
balance, inserts and reserves the days. The second transaction blocks until the
first commits and then sees the reservation.

`pending_days` is what makes this work: reserved days are subtracted from
availability immediately, so the UI never offers days that are effectively
already spent, and a rejection releases them without touching `used_days`.

### The recursive CTE

The org chart is the one query that would be genuinely bad done naively:

- **N queries** ("fetch my reports, then each of theirs") is one round trip per
  node. Fine for twelve people, seconds of latency for four thousand.
- **Fetch everything and build the tree in Node** moves every employee row over
  the wire, including the 95% the viewer did not ask for, and cannot be
  depth-limited by the database.
- **`WITH RECURSIVE`** walks the adjacency list inside MySQL using
  `idx_employees_manager`, returns exactly the requested subtree in one round
  trip, and computes `depth` and a materialised `path` on the way down.

Because rows come back ordered by `path`, a parent is always seen before its
children, so `buildTree` assembles the nesting in a single pass with one map
lookup per row.

The `depth < ?` bound is not decoration. Bad data introducing a cycle (A
manages B manages A) would otherwise spin until `cte_max_recursion_depth`
aborts the query with an error; the guard turns that into a truncated tree.
`employeesService.update` separately refuses any manager reassignment that
would create a cycle.

### Dates

MySQL `DATE` columns come back as `YYYY-MM-DD` strings (`dateStrings: ['DATE']`
in the knex config). Leave dates are calendar dates, not instants — letting the
driver hand back a JS `Date` would shift them by the container's UTC offset,
which is exactly how "my leave started a day early" bugs happen.

---

## 6. Cross-cutting concerns

**Validation.** Zod at the edge, in `validate(schema)`. Parsed output
*replaces* the request segment, so controllers receive coerced values and
unknown keys are stripped before anything reaches a repository.

**Errors.** One exit point. `ApiError` for expected failures; MySQL driver
codes are translated (`ER_DUP_ENTRY` → 409, `ER_NO_REFERENCED_ROW_2` → 400);
anything else is logged with its stack and flattened to a generic 500 so SQL
fragments never reach a browser. Every response carries `requestId`.

**Logging.** Winston, JSON in production. `requestId` middleware seeds an
`AsyncLocalStorage` store, so every log line from controller to repository
carries the same correlation id without threading a logger through signatures.
Errors also go to their own transport.

**Rate limiting.** Two budgets: a broad one keyed on user-or-IP for the API,
and a much tighter one on credential endpoints keyed on IP **and** the
submitted email, so one attacker cannot lock out an office NAT while a
distributed attempt on a single account is still throttled.

**Graceful shutdown.** On SIGTERM the server stops accepting connections, lets
in-flight requests finish, drains the MySQL pool, and exits — with a 15-second
watchdog that forces the exit if a socket refuses to close. `dumb-init` is PID
1 in the container so the signal actually arrives.

---

## 7. Scaling path

Today's deployment is one API container and one nginx container per colour, and
a single MySQL instance. What changes, in the order it would be needed:

1. **Horizontal API replicas** (nothing to change). The API is already
   stateless; the only shared mutable state is MySQL. Rate-limit counters are
   per-process, which is acceptable until replica count makes the effective
   limit misleading — at that point the limiter moves to a Redis store.
2. **Read replicas.** The directory, org chart, calendar and dashboard are all
   read-only and tolerate replication lag of a second. Knex takes a second
   connection pool and repositories opt in per method; the write path stays on
   the primary. This is the single biggest win and needs no schema change.
3. **Uploads to object storage.** `multer` disk storage becomes an S3 client;
   `documents.storage_key` already stores an opaque key rather than a path, so
   only the two functions that resolve a key need to change.
4. **Cache the expensive reads.** The org chart changes a handful of times a
   month and is the costliest query. It caches cleanly in Redis keyed on
   `(rootEmployeeId, maxDepth)`, invalidated on any `manager_id` write.
5. **Pagination strategy.** Offset pagination is correct for today's screens:
   users jump to arbitrary pages and sort by arbitrary columns, which a cursor
   cannot express. It degrades at large offsets because MySQL still walks the
   skipped rows. The audit log is where that bites first, and it is also the
   one list that is strictly reverse-chronological — so it is the first
   candidate for keyset pagination (`WHERE (created_at, id) < (?, ?)`), while
   the directory keeps offsets.
6. **Table growth.** `audit_logs` and `timesheet_entries` grow monotonically.
   Both are natural candidates for `PARTITION BY RANGE` on the month, with a
   retention job dropping old partitions instead of running mass deletes.
7. **Extracting a service.** If a module ever justifies its own deployable, the
   module boundary is already the seam: each domain owns its tables and is
   reached only through its service. Leave (with its workflow and its own
   notification needs) would go first.

What is deliberately *not* on this list: a client-side store, GraphQL, and a
message broker. None of them solve a problem this application currently has,
and each would add a layer that every future contributor has to learn.
