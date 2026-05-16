# CI/CD

A full walkthrough of the delivery pipeline: what each stage does, what it
blocks, how code is promoted between environments, and how to get back to a
known-good state when a release goes wrong.

Jenkins is the deployment path. [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)
mirrors the verification stages so a fork without a Jenkins controller still
gets the same signal, but it stops at building images.

---

## 1. Pipeline at a glance

```
Checkout → Install → Lint → Unit tests → SonarQube → Quality gate
        → Build → Postman/Newman → Docker build & push
        → Deploy staging → Smoke tests → [manual approval] → Deploy production
```

Total runtime on a warm agent: about 9 minutes to the end of Newman, about 14
minutes to a staging deployment. The pipeline uses `agent none` at the top and
pins each stage to a `node:22-alpine` container or a Docker agent, so the
controller needs no Node.js toolchain of its own.

---

## 2. Stage by stage

### Checkout

Captures `GIT_COMMIT`, the author and the subject line, then renames the build
to `#42 · 4f2c9ab1de03`. The short SHA becomes `IMAGE_TAG` and is the build's
identity from here on: it tags both images, labels the containers, and is
served by `/health` so a running container can always be traced to the build
that produced it.

### Install

`npm ci` for `api` and `web` in parallel. `ci`, never `install` — the lockfile
is authoritative, and a build must not silently resolve a dependency tree that
nobody reviewed.

### Lint

ESLint for both workspaces plus `tsc --noEmit` for the API, all in parallel
with `failFast: false` so one report shows every problem rather than the first
one. `--max-warnings 0`: a warning nobody fixes is a warning nobody reads.

### Unit tests

Jest on both sides in parallel, emitting JUnit XML and Cobertura coverage.

Post-steps publish `junit` (with `allowEmptyResults: false` — a run that
produced no report is a broken pipeline, not a passing build),
`recordCoverage` with thresholds that mark the build **unstable** below 55%
line / 45% branch coverage, and the lcov HTML report via `publishHTML`.

Unstable, not failed, is deliberate: a coverage dip is worth a Slack warning
and a conversation, not a blocked deployment. A *failing test* fails the build.

### SonarQube analysis and quality gate

`withSonarQubeEnv('sonarqube-prod')` runs the scanner against `api/src` and
`web/src`, feeding it the lcov reports from the previous stage so coverage is
measured on new code specifically.

`waitForQualityGate abortPipeline: true` then blocks on the SonarQube webhook.
The `Portal Way` gate fails on new code when coverage is below 80%, duplicated
lines exceed 3%, any rating drops below A, or a security hotspot is unreviewed.

This runs **before** the Docker stage, so a regression never produces a pushed
image. The `SKIP_QUALITY_GATE` parameter exists for genuine break-glass
situations and the choice is recorded in the build log.

### Build

`tsc` for the API and `ng build --configuration production` for the SPA, in
parallel. The production configuration applies the bundle budgets declared in
`angular.json` (800kB initial error threshold), so a dependency that bloats the
entry chunk fails here rather than shipping. Artefacts are archived with
fingerprints.

### Postman API validation

The most valuable stage in the pipeline, and the reason a contract regression
cannot reach an environment.

1. Bring up an ephemeral `mysql` + `api` stack via compose, under a
   build-scoped project name.
2. Poll `/api/v1/health/ready` — the readiness probe, which includes a database
   round trip — up to 40 times.
3. Run migrations and the demo seed through the `migrate` compose profile.
4. Run the 39-request collection in `postman/newman:6-alpine` with
   `--bail failure`.
5. Publish `junit.xml` and the htmlextra HTML report.
6. Tear the stack down **with its volumes**, always. A leaked MySQL volume
   would make the next build's seed non-deterministic.

The collection asserts far more than status codes: refresh-token rotation and
reuse detection, two RBAC 403s, overlap detection returning 409 with the
conflicting request id, the leave state machine walking
`PENDING → MANAGER_APPROVED → APPROVED`, balance arithmetic before and after
the workflow, and org-chart tree integrity. Three assertions run against every
request — response time under 1500ms, an echoed `X-Request-Id`, and no
`X-Powered-By`.

`--bail failure` stops on the first failed assertion, because once the workflow
chain breaks every later request fails for the same reason and the noise buries
the cause.

### Docker build & push

`main` only. `docker buildx` builds both images for `linux/amd64` with a
registry-backed layer cache, labels them with the revision and source, and
pushes `:${IMAGE_TAG}` and `:latest` in a single invocation — one call, so
`:latest` can never point at a different build than the SHA tag.

Images are multi-stage: the API runtime carries no TypeScript toolchain and no
dev dependencies (~180MB), and the web runtime is nginx with static files only
(~55MB, no Node.js at all). Both run as non-root with a `HEALTHCHECK`.

### Deploy to staging

`jenkins/scripts/deploy.sh` over SSH with an agent-forwarded key. Pulls the
images before stopping anything, applies migrations, brings up the idle colour,
waits for its health check, flips the nginx upstream.

### Smoke tests

`jenkins/scripts/smoke-test.sh` against the deployed URL. Not a rerun of
Newman — six focused checks that fit inside a deploy window: liveness, the
**deployed version matching `IMAGE_TAG`** (which catches a deploy that silently
kept serving the old image), readiness including the database, SPA deep-link
fallback, a real login plus two negative auth cases, RBAC, and a latency
budget.

### Manual approval

An `input` step with `agent none`, so the gate holds no executor while it
waits. Restricted to the `release-managers` and `platform-leads` groups, with a
60-minute timeout. The approver picks the strategy (`blue-green` or
`rolling`), whether to run migrations, and supplies a change ticket. The
approver's name is captured via `submitterParameter` and appears in the Slack
message.

### Deploy to production

Same script, production host, blue/green by default, followed immediately by
the smoke tests against production. The stage's own `post { failure { … } }`
calls `deploy.sh --rollback`, so a failed verification reverts automatically
rather than waiting for a human to notice.

### Post

`always` archives reports and cleans the workspace (keeping `node_modules`);
`success`, `unstable`, `failure` and `aborted` each send a differently coloured
Slack message, and a failure also emails the compressed log.

---

## 3. Stage failure behaviour

| Stage | On failure | Blocks deployment? |
| --- | --- | --- |
| Install | Fail immediately (`failFast`) | Yes |
| Lint | Fail after all linters report | Yes |
| Unit tests | Fail on a failing test; **unstable** on low coverage | Yes / No |
| SonarQube | Fail | Yes |
| Quality gate | Abort the pipeline | Yes — before any image exists |
| Build | Fail (includes exceeding a bundle budget) | Yes |
| Newman | Fail on the first failed assertion | Yes — before any image is pushed |
| Docker push | Fail | Yes |
| Deploy staging | Fail; the previous colour keeps serving | — |
| Smoke tests | Fail | Blocks the production gate |
| Approval | Abort on timeout | Yes |
| Deploy production | Automatic rollback to the previous colour | — |

---

## 4. Branch strategy

Trunk-based with short-lived branches.

- `main` is always releasable and is protected: no direct pushes, one approving
  review, and the `portal-ci` check must be green.
- Branches live hours to days. `feat/…`, `fix/…`, `chore/…`, `docs/…`.
- Pull requests run the full verification set (the multibranch job builds the
  PR merge commit, not the branch head) and stop before the Docker stage.
- Squash merge; the squashed subject is a Conventional Commit and becomes the
  changelog line.
- No long-lived `develop` or release branches. Anything not ready to be visible
  ships behind a flag rather than on a branch.

---

## 5. Versioning and tagging

| Artefact | Scheme | Example |
| --- | --- | --- |
| Docker images | 12-char commit SHA, plus `latest` | `employee-portal-api:4f2c9ab1de03` |
| Git release tags | SemVer on `main` | `v1.4.0` |
| npm `package.json` | SemVer, bumped with the release tag | `1.4.0` |
| Runtime version | `APP_VERSION` env → `/health` | `4f2c9ab1de03` |

The SHA is the deployment identity; SemVer is the human-facing identity. That
separation is what lets the smoke test assert "the thing serving traffic is
exactly the thing this build produced" — a release tag cannot do that, because
several builds can share one.

`:latest` exists for convenience only. Deployments always pass an explicit
`--tag`, because a rollback needs to name a specific previous build.

---

## 6. Environment promotion

| Environment | Trigger | Data | URL |
| --- | --- | --- | --- |
| Local | `docker compose up` | Seeded demo dataset | `localhost:3000` |
| CI ephemeral | Every Newman stage | Seeded, destroyed after | in-container |
| Staging | Every green `main` | Anonymised production restore, weekly | `staging.employee-portal.internal` |
| Production | Manual gate on a staged build | Live | `portal.example.com` |

The same image is promoted; nothing is rebuilt between environments. Only
environment variables differ. A build that reaches production has run the full
test suite, passed the quality gate, passed the contract tests, and been smoke
tested on staging **as that exact image**.

---

## 7. Deployment mechanics

The target host runs two identical compose projects, `portal-blue` and
`portal-green`, behind an nginx upstream file. Exactly one is live, recorded in
`.active-color`.

1. Ship the compose file, pull the images — a registry problem fails here,
   while the old version is still serving.
2. Run migrations if asked. Migrations are additive by convention, so the old
   colour keeps working against the migrated schema during the overlap.
3. Start the idle colour on its own ports.
4. Poll its readiness probe, up to 30 attempts. If it never passes, tear the
   new colour down and leave the old one live — traffic never moved.
5. Symlink the upstream file to the new colour, `nginx -t`, reload.
6. Record the old colour in `.previous-color`, drain it after a 60-second
   grace period.

The old colour stays running through step 6, which is what makes a rollback
seconds rather than a rebuild.

---

## 8. Rollback

**Automatic.** The production stage's `post { failure }` block runs
`deploy.sh --rollback` whenever the post-deploy smoke tests fail.

**Manual, fastest path** — flip the upstream back to the still-running previous
colour:

```bash
ssh deploy@portal.example.com
cd /opt/employee-portal
./deploy.sh --environment production --host portal.example.com \
            --user deploy --registry ghcr.io/<owner> --rollback
```

Typical time to recover: under 30 seconds.

**After the grace period**, when the old colour has been stopped, redeploy the
previous tag explicitly:

```bash
./jenkins/scripts/deploy.sh --environment production \
  --host portal.example.com --user deploy \
  --registry ghcr.io/<owner> --tag <previous-sha>
```

**Database rollback** is the case worth planning for, because it is the one
that is not free. Every migration has a working `down()`, but a `down()` that
drops a column destroys data. The operational rule:

- Schema changes are **additive** within a release — add a column, backfill,
  start writing to it; remove the old one a release later.
- That way a code rollback never needs a schema rollback, which is the whole
  point.
- If a destructive migration is genuinely unavoidable, it ships alone, in its
  own release, with a verified backup taken immediately before.

Recovery order during an incident: flip the colour first, investigate second.
The `X-Request-Id` in the error response ties a user's report to the exact log
stream and the audit row for that call.

---

## 9. Credentials and plugins

Full list with setup instructions: [`../jenkins/README.md`](../jenkins/README.md).

Credential IDs referenced by the `Jenkinsfile`:

| ID | Kind | Used by |
| --- | --- | --- |
| `portal-registry-credentials` | Username/password | GHCR push |
| `portal-sonarqube-token` | Secret text | Analysis and quality gate |
| `portal-staging-ssh-key` | SSH key | Staging deploy |
| `portal-production-ssh-key` | SSH key | Production deploy |
| `portal-ci-jwt-access-secret` | Secret text | Ephemeral Newman stack |
| `portal-ci-jwt-refresh-secret` | Secret text | Ephemeral Newman stack |
| `portal-github-token` | Username/password | Multibranch scanning (seed job) |

The CI JWT secrets are deliberately not the production ones — the Newman stack
is destroyed with its volumes at the end of the stage.

Key plugins: `workflow-aggregator`, `docker-workflow`, `github-branch-source`,
`timestamper`, `ansicolor`, `junit`, `coverage`, `htmlpublisher`, `sonar`,
`ssh-agent`, `credentials-binding`, `slack`, `email-ext`, `ws-cleanup`,
`job-dsl`.

---

## 10. Jobs

Seeded from [`../jenkins/seed-job.groovy`](../jenkins/seed-job.groovy):

| Job | Trigger | Purpose |
| --- | --- | --- |
| `portal-ci` | Push and PR webhook | The multibranch pipeline |
| `portal-nightly` | `H 2 * * 1-5` | Full run of `main` with Newman, no deployment — catches drift in transitive dependencies and in the seeded dataset |
| `portal-release-production` | Manual | Promotes `main` with `DEPLOY_ENV=production` pre-selected; still passes the in-pipeline approval gate |
| `portal-agent-housekeeping` | `H 4 * * 0` | Weekly Docker prune so the buildx layer cache cannot fill the agent disk |
