# Jenkins setup

Everything needed to run [`../Jenkinsfile`](../Jenkinsfile) on a fresh controller.

---

## 1. Controller requirements

| Requirement | Notes |
| --- | --- |
| Jenkins | 2.452+ (LTS), declarative pipeline |
| Agents | At least one labelled `linux && docker` with a Docker socket |
| Docker | 24+ with `buildx` (the image stage uses registry-backed layer caching) |
| Disk | ~15GB free on the agent for node_modules, images and layer cache |
| Outbound | `ghcr.io`, `registry.npmjs.org`, the SonarQube host, the deploy hosts |

The pipeline uses `agent none` at the top level and pins each stage to either a
`node:22-alpine` container or a raw Docker agent, so the controller itself
needs no Node.js, no npm and no Angular CLI.

---

## 2. Required plugins

| Plugin | Used for |
| --- | --- |
| `workflow-aggregator` | Declarative pipeline |
| `docker-workflow` | `agent { docker { image ... } }` |
| `git` / `github-branch-source` | SCM, multibranch discovery, PR builds |
| `timestamper` | `options { timestamps() }` |
| `ansicolor` | `options { ansiColor('xterm') }` |
| `junit` | Jest and Newman JUnit reports |
| `coverage` | `recordCoverage` with the Cobertura parser |
| `htmlpublisher` | Newman HTML report and the lcov coverage site |
| `sonar` | `withSonarQubeEnv` and `waitForQualityGate` |
| `ssh-agent` | `sshagent(credentials: [...])` around the deploy scripts |
| `credentials-binding` | `credentials()` bindings in `environment` |
| `slack` | Build notifications |
| `email-ext` | Failure emails with the compressed log |
| `ws-cleanup` | `cleanWs()` in the `post` block |
| `job-dsl` | Seeding the jobs from `seed-job.groovy` |
| `build-timeout`, `pipeline-stage-view` | Timeouts and the stage view |

Install non-interactively:

```bash
jenkins-plugin-cli --plugins \
  workflow-aggregator docker-workflow git github-branch-source timestamper \
  ansicolor junit coverage htmlpublisher sonar ssh-agent credentials-binding \
  slack email-ext ws-cleanup job-dsl build-timeout pipeline-stage-view
```

---

## 3. Credentials

Create these under **Manage Jenkins → Credentials → System → Global**. The IDs
are referenced verbatim by the `Jenkinsfile`, so they must match exactly.

| ID | Kind | Purpose |
| --- | --- | --- |
| `portal-registry-credentials` | Username with password | GHCR push (`REGISTRY_CREDS_USR` / `_PSW`) |
| `portal-sonarqube-token` | Secret text | SonarQube analysis and quality-gate polling |
| `portal-staging-ssh-key` | SSH username with private key | `deploy@staging.employee-portal.internal` |
| `portal-production-ssh-key` | SSH username with private key | `deploy@portal.example.com` |
| `portal-ci-jwt-access-secret` | Secret text | Throwaway secret for the ephemeral Newman stack |
| `portal-ci-jwt-refresh-secret` | Secret text | Ditto, refresh tokens |
| `portal-slack-token` | Secret text | Slack plugin (configured globally, not in the file) |

Generate the CI JWT secrets like any other:

```bash
openssl rand -hex 48
```

They are deliberately *not* the production secrets: the Newman stack is torn
down with its volumes at the end of the stage.

---

## 4. SonarQube

1. Create a project with key `enterprise-employee-portal`.
2. **Manage Jenkins → System → SonarQube servers**: add a server named
   `sonarqube-prod` (the name `withSonarQubeEnv('sonarqube-prod')` expects)
   and select the `portal-sonarqube-token` credential.
3. In SonarQube, add a webhook pointing at
   `https://<jenkins-host>/sonarqube-webhook/`. Without it `waitForQualityGate`
   blocks until the 10-minute timeout.
4. Quality gate used (`Portal Way`):

   | Condition | Threshold on new code |
   | --- | --- |
   | Coverage | ≥ 80% |
   | Duplicated lines | ≤ 3% |
   | Maintainability rating | A |
   | Reliability rating | A |
   | Security rating | A |
   | Security hotspots reviewed | 100% |

A failing gate aborts the pipeline **before** the Docker stage, so a regression
never produces a pushed image.

---

## 5. Creating the jobs

### Option A — Job DSL seed job (recommended)

1. Create a freestyle job named `seed-employee-portal`.
2. Add a **Process Job DSLs** build step with
   *Look on Filesystem* → `jenkins/seed-job.groovy`.
3. Run it once. It creates the multibranch pipeline, the nightly job and the
   manual release job described in that script.

### Option B — Manual multibranch pipeline

1. **New Item → Multibranch Pipeline**, name `employee-portal`.
2. Branch source: GitHub → `<owner>/enterprise-employee-portal`.
3. Behaviours: *Discover branches* (exclude those that are also PRs),
   *Discover pull requests from origin* (merge with target), *Clean before
   checkout*.
4. Build configuration: *by Jenkinsfile*, script path `Jenkinsfile`.
5. Scan triggers: on GitHub webhook, plus a daily fallback scan.

---

## 6. Agent preparation

```bash
# Docker access for the Jenkins agent user
sudo usermod -aG docker jenkins

# buildx builder used by the image stage
docker buildx create --name portal-builder --use
docker buildx inspect --bootstrap

# Prune weekly so the layer cache does not fill the disk
echo '0 3 * * 0 root docker system prune -af --filter "until=168h"' \
  | sudo tee /etc/cron.d/docker-prune
```

---

## 7. Parameters at a glance

| Parameter | Default | Effect |
| --- | --- | --- |
| `DEPLOY_ENV` | `staging` | Highest environment this run may reach. `none` verifies only. |
| `RUN_E2E` | `true` | Runs the Postman/Newman stage against an ephemeral compose stack. |
| `SKIP_QUALITY_GATE` | `false` | Break-glass bypass of the Sonar gate; the choice is recorded in the build log. |

---

## 8. Scripts

| Script | Purpose |
| --- | --- |
| [`scripts/deploy.sh`](scripts/deploy.sh) | Blue/green or rolling deploy over SSH, with `--rollback` |
| [`scripts/smoke-test.sh`](scripts/smoke-test.sh) | Post-deploy verification: health, version, auth, RBAC, latency |
| [`seed-job.groovy`](seed-job.groovy) | Job DSL definitions for the whole folder |

Both scripts are plain POSIX shell with `set -euo pipefail` and can be run by
hand during an incident — they take the same flags Jenkins passes.
