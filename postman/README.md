# Postman / Newman API validation

The collection is the executable contract for the API. It runs in Postman
during development and headlessly with Newman in the Jenkins pipeline and in
GitHub Actions.

| File | Purpose |
| --- | --- |
| `EmployeePortal.postman_collection.json` | 39 requests in six ordered folders, ~110 assertions |
| `EmployeePortal.local.postman_environment.json` | Local variables and the seeded demo credentials |

---

## What it covers

The folders run in order and chain through environment variables, so a single
run exercises a complete employee → manager → HR workflow rather than a set of
isolated pokes at endpoints.

| Folder | Covers |
| --- | --- |
| `00 · Health` | Readiness probe, including the database round trip |
| `01 · Auth` | Login for all three roles, `/auth/me`, 401 on a missing token, refresh **rotation**, and a replayed refresh token being rejected |
| `02 · Employees` | Pagination envelope, search, sort-column whitelist (400), own profile, and two RBAC 403s |
| `03 · Leave` | Leave types, balance arithmetic, submission, the pending-days reservation, overlap (409), inverted dates (400), calendar range cap |
| `04 · Approval workflow` | Self-approval blocked, manager queue, rejection without a comment refused, `PENDING → MANAGER_APPROVED → APPROVED`, duplicate decision refused, approval trail, balance moving from pending to used |
| `05 · Everything else` | Projects, Monday-only week addressing, org chart (tree integrity + latency), dashboard shape, announcement feed and read receipt, structured 404 |

Three assertions run against **every** request, from the collection-level test
script:

- response time under 1500ms,
- an `X-Request-Id` header is echoed (so a failure is traceable in the logs),
- no `X-Powered-By` banner.

The interesting assertions are not just status codes. For example the org-chart
test walks the returned tree and checks that `totalReports` equals the actual
node count, and the leave tests verify that
`available = entitled + carried − used − pending` both before and after the
workflow runs.

---

## Running it

### Postman (GUI)

1. Import both JSON files.
2. Select the **Employee Portal — Local** environment.
3. Start the stack (`docker compose up -d`) and seed it.
4. Run the collection. Folders must run in order — the chaining depends on it.

### Newman (CLI)

```bash
npm install --global newman newman-reporter-htmlextra

newman run postman/EmployeePortal.postman_collection.json \
  --environment postman/EmployeePortal.local.postman_environment.json \
  --reporters cli,htmlextra,junit \
  --reporter-htmlextra-export reports/newman/report.html \
  --reporter-junit-export reports/newman/junit.xml \
  --timeout-request 10000 \
  --bail failure
```

From the API workspace there is a shortcut that uses the same flags:

```bash
cd api && npm run test:newman
```

Point it at another environment by overriding `baseUrl` on the command line:

```bash
newman run postman/EmployeePortal.postman_collection.json \
  --environment postman/EmployeePortal.local.postman_environment.json \
  --env-var "baseUrl=https://staging.employee-portal.internal/api/v1"
```

### Docker (no local Newman)

```bash
docker run --rm --network host -v "$PWD:/etc/newman" -w /etc/newman \
  postman/newman:6-alpine \
    run postman/EmployeePortal.postman_collection.json \
    -e postman/EmployeePortal.local.postman_environment.json
```

---

## How it is wired into CI

**Jenkins** — the *Postman API validation* stage:

1. brings up an ephemeral `mysql` + `api` compose stack (`RUN_E2E` gates it),
2. polls `/api/v1/health/ready` until the API answers,
3. runs migrations and the demo seed through the `migrate` profile,
4. runs Newman in the `postman/newman:6-alpine` image with `--bail failure`,
5. publishes `reports/newman/junit.xml` via `junit` and
   `reports/newman/report.html` via `publishHTML`,
6. tears the stack down **with its volumes** in `post { always { … } }`, so the
   next build's seed is deterministic.

`--bail failure` stops on the first failed assertion: once the workflow chain
is broken, every later request would fail for the same reason and the noise
buries the real cause.

Because the stage sits before *Docker build & push*, a contract regression
stops the pipeline before any image reaches the registry.

**GitHub Actions** — the `newman` job does the same thing with a `mysql:8.0`
service container instead of compose, and uploads the HTML report as a build
artifact.

---

## The HTML report

`newman-reporter-htmlextra` produces a single self-contained page with a
pass/fail summary, every request's full headers and body, the assertion
results, and a response-time chart. Jenkins publishes it as **Newman API
report** on the build page; GitHub Actions attaches it as the `newman-report`
artifact. When an API change breaks the contract, that page shows the exact
request, the exact payload and the exact assertion that failed — usually enough
to diagnose without reproducing anything locally.

---

## Maintaining it

- Adding an endpoint means adding a request **and** its assertions; a request
  with only a status-code check is barely worth the runtime.
- Keep the folder order. `03 · Leave` stores `leaveRequestId`, and the whole of
  `04 · Approval workflow` acts on it.
- The collection assumes the seeded dataset from `api/src/db/seeds`. If the
  seed changes, the counts in `02 · Employees` and the balance arithmetic in
  `03 · Leave` may need updating with it.
