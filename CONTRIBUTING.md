# Contributing

Thanks for taking a look. This document describes how the project is developed
so a change can get from a local branch to production without surprises.

---

## Getting set up

```bash
git clone https://github.com/<your-username>/enterprise-employee-portal.git
cd enterprise-employee-portal

cp .env.example .env
# generate real secrets — compose refuses to start with the placeholders
openssl rand -hex 48   # JWT_ACCESS_SECRET
openssl rand -hex 48   # JWT_REFRESH_SECRET

docker compose up -d --build
docker compose --profile tools run --rm migrate
```

For day-to-day work run the services on the host instead, so both sides hot
reload:

```bash
docker compose up -d mysql adminer
cd api && npm install && npm run migrate && npm run seed && npm run dev
cd web && npm install && npm start
```

---

## Branching

Trunk-based, with short-lived branches:

- `main` is always releasable, and is protected.
- Branch names: `feat/leave-calendar-export`, `fix/refresh-token-race`,
  `chore/bump-angular-18-2`, `docs/architecture-scaling`.
- Aim to merge within two days. A branch that lives a week is a branch that
  will conflict.
- Squash merge. The squashed subject becomes the changelog line.

---

## Commits

[Conventional Commits](https://www.conventionalcommits.org/), because the
release notes and the version bump are derived from them:

```
feat(leave): add half-day support to the request form
fix(auth): revoke the session family on refresh-token reuse
perf(orgchart): replace the N+1 traversal with a recursive CTE
test(leave): cover the balance gate for unpaid leave types
docs(ci): document the manual production approval gate
chore(deps): bump mysql2 to 3.11.5
```

Scopes in use: `auth`, `employees`, `departments`, `leave`, `timesheets`,
`documents`, `announcements`, `orgchart`, `dashboard`, `web`, `api`, `ci`,
`docker`, `deps`.

---

## Before you open a pull request

```bash
# API
cd api
npm run lint
npm run typecheck
npm test

# Web
cd ../web
npm run lint
npm test
npm run build:prod     # enforces the bundle budgets

# Contract
cd ..
newman run postman/EmployeePortal.postman_collection.json \
  -e postman/EmployeePortal.local.postman_environment.json
```

The pipeline runs all of this anyway, but finding out locally is faster than
finding out in CI.

---

## Code conventions

**API**

- One folder per domain under `src/modules`, with the same five files:
  `*.routes.ts`, `*.controller.ts`, `*.service.ts`, `*.repository.ts`,
  `*.schema.ts`.
- Controllers do not contain business rules; repositories do not contain
  authorisation. The service is where both meet.
- Every controller is wrapped in `asyncHandler`; every expected failure is an
  `ApiError`. Anything else reaching `errorHandler` is a bug and becomes a 500.
- No raw SQL outside a repository. Where raw SQL is unavoidable (the recursive
  CTE), it is parameterised and commented with the reason.

**Web**

- Standalone components only, `ChangeDetectionStrategy.OnPush`, `inject()`
  rather than constructor parameters.
- `signal()` / `computed()` for state; `toSignal` at the edge of an observable.
  Subscriptions carry `takeUntilDestroyed`.
- `@if` / `@for` control flow in templates — the ESLint config enforces it.
- Feature components talk to a feature service, never to `HttpClient` directly.

**Both**

- No `any` without a comment explaining why the type cannot be expressed.
- Comments explain *why*, not *what*. If a line needs a comment to say what it
  does, rewrite the line.

---

## Reporting a security issue

Please do not open a public issue. Use GitHub's private vulnerability
reporting (the repository's **Security** tab, then **Report a vulnerability**)
with the details and a reproduction, and allow a reasonable window before
disclosure.
