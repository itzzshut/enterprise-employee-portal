#!/usr/bin/env groovy

/**
 * Enterprise Employee Portal — delivery pipeline.
 *
 * Trunk-based: every push to `main` and every pull request runs the full
 * verification set. Only `main` builds and pushes images; only `main` can
 * reach the production approval gate.
 *
 *   Checkout → Install → Lint → Unit tests → SonarQube + quality gate
 *           → Build → Newman API validation → Docker build & push
 *           → Deploy staging → Smoke tests → [manual approval] → Deploy prod
 *
 * Required plugins and credential IDs are listed in jenkins/README.md.
 */

pipeline {
  agent none

  options {
    timestamps()
    ansiColor('xterm')
    timeout(time: 45, unit: 'MINUTES')
    buildDiscarder(logRotator(numToKeepStr: '30', artifactNumToKeepStr: '10'))
    disableConcurrentBuilds(abortPrevious: true)
    skipDefaultCheckout(true)
    durabilityHint('PERFORMANCE_OPTIMIZED')
  }

  parameters {
    choice(
      name: 'DEPLOY_ENV',
      choices: ['staging', 'production', 'none'],
      description: 'Highest environment this run may deploy to. `production` still requires the manual gate.'
    )
    booleanParam(
      name: 'RUN_E2E',
      defaultValue: true,
      description: 'Run the Postman/Newman API validation suite against an ephemeral compose stack.'
    )
    booleanParam(
      name: 'SKIP_QUALITY_GATE',
      defaultValue: false,
      description: 'Break glass only: bypass the SonarQube quality gate (recorded in the build log).'
    )
  }

  environment {
    REGISTRY        = "ghcr.io/${env.REGISTRY_OWNER ?: 'your-org'}"
    API_IMAGE       = "${REGISTRY}/employee-portal-api"
    WEB_IMAGE       = "${REGISTRY}/employee-portal-web"
    // Short SHA is the immutable build identity: it tags the images, labels the
    // deployment and appears in the /health payload, so a running container can
    // always be traced back to this build.
    IMAGE_TAG       = "${env.GIT_COMMIT ? env.GIT_COMMIT.take(12) : env.BUILD_NUMBER}"
    NODE_VERSION    = '22'
    NPM_CONFIG_CACHE = "${WORKSPACE}/.npm"
    CI              = 'true'

    REGISTRY_CREDS  = credentials('portal-registry-credentials')
    SONAR_TOKEN     = credentials('portal-sonarqube-token')
    STAGING_SSH     = credentials('portal-staging-ssh-key')
    PROD_SSH        = credentials('portal-production-ssh-key')
    SLACK_CHANNEL   = '#portal-deploys'
  }

  stages {

    stage('Checkout') {
      agent { label 'linux && docker' }
      steps {
        checkout scm
        script {
          env.GIT_SHORT   = sh(script: 'git rev-parse --short=12 HEAD', returnStdout: true).trim()
          env.GIT_AUTHOR  = sh(script: 'git log -1 --pretty=%an', returnStdout: true).trim()
          env.GIT_SUBJECT = sh(script: 'git log -1 --pretty=%s', returnStdout: true).trim()
          currentBuild.displayName = "#${env.BUILD_NUMBER} · ${env.GIT_SHORT}"
          currentBuild.description = "${env.GIT_SUBJECT} (${env.GIT_AUTHOR})"
        }
        stash name: 'source', useDefaultExcludes: false, excludes: '.git/**'
      }
    }

    stage('Install') {
      agent {
        docker {
          image "node:${NODE_VERSION}-alpine"
          label 'linux && docker'
          args '-v $HOME/.npm-cache:/root/.npm'
          reuseNode true
        }
      }
      steps {
        // `npm ci` (not `install`) so the lockfile is authoritative — a build
        // must never silently resolve a different dependency tree than the one
        // that was reviewed.
        script {
          parallel(
            'api deps': {
              dir('api') { sh 'npm ci --no-audit --no-fund' }
            },
            'web deps': {
              dir('web') { sh 'npm ci --no-audit --no-fund' }
            },
            failFast: true
          )
        }
      }
    }

    stage('Lint') {
      agent {
        docker {
          image "node:${NODE_VERSION}-alpine"
          label 'linux && docker'
          reuseNode true
        }
      }
      steps {
        script {
          parallel(
            'api eslint': {
              dir('api') { sh 'npm run lint' }
            },
            'web eslint': {
              dir('web') { sh 'npm run lint' }
            },
            'api typecheck': {
              dir('api') { sh 'npm run typecheck' }
            },
            failFast: false
          )
        }
      }
    }

    stage('Unit tests') {
      agent {
        docker {
          image "node:${NODE_VERSION}-alpine"
          label 'linux && docker'
          reuseNode true
        }
      }
      steps {
        script {
          parallel(
            'api jest': {
              dir('api') { sh 'npm run test:ci' }
            },
            'web jest': {
              dir('web') { sh 'npm run test:ci' }
            },
            failFast: false
          )
        }
      }
      post {
        always {
          // allowEmptyResults stays false on purpose: a run that produced no
          // test report is a broken pipeline, not a passing build.
          junit testResults: '**/reports/junit/*.xml', allowEmptyResults: false, keepLongStdio: true

          recordCoverage(
            tools: [
              [parser: 'COBERTURA', pattern: 'api/coverage/cobertura-coverage.xml'],
              [parser: 'COBERTURA', pattern: 'web/coverage/cobertura-coverage.xml']
            ],
            sourceCodeRetention: 'EVERY_BUILD',
            qualityGates: [
              [threshold: 55.0, metric: 'LINE', baseline: 'PROJECT', unstable: true],
              [threshold: 45.0, metric: 'BRANCH', baseline: 'PROJECT', unstable: true]
            ]
          )

          publishHTML target: [
            reportName: 'API coverage',
            reportDir: 'api/coverage/lcov-report',
            reportFiles: 'index.html',
            keepAll: true,
            alwaysLinkToLastBuild: true,
            allowMissing: true
          ]
        }
      }
    }

    stage('SonarQube analysis') {
      when {
        anyOf {
          branch 'main'
          changeRequest()
        }
      }
      agent {
        docker {
          image 'sonarsource/sonar-scanner-cli:11'
          label 'linux && docker'
          reuseNode true
        }
      }
      steps {
        withSonarQubeEnv('sonarqube-prod') {
          sh '''
            sonar-scanner \
              -Dsonar.projectKey=enterprise-employee-portal \
              -Dsonar.projectVersion=${IMAGE_TAG} \
              -Dsonar.sources=api/src,web/src \
              -Dsonar.exclusions=**/*.test.ts,**/*.spec.ts,**/db/migrations/**,**/db/seeds/** \
              -Dsonar.tests=api/src,web/src \
              -Dsonar.test.inclusions=**/*.test.ts,**/*.spec.ts \
              -Dsonar.typescript.tsconfigPaths=api/tsconfig.json,web/tsconfig.json \
              -Dsonar.javascript.lcov.reportPaths=api/coverage/lcov.info,web/coverage/lcov.info
          '''
        }
      }
    }

    stage('Quality gate') {
      when {
        allOf {
          not { expression { return params.SKIP_QUALITY_GATE } }
          anyOf { branch 'main'; changeRequest() }
        }
      }
      steps {
        // Blocks on the SonarQube webhook. `abortPipeline: true` means a gate
        // failure — new bugs, security hotspots, coverage on new code below
        // 80%, duplication over 3% — stops the build before any image is
        // pushed, so a regression can never reach a registry or a deployment.
        timeout(time: 10, unit: 'MINUTES') {
          waitForQualityGate abortPipeline: true, credentialsId: 'portal-sonarqube-token'
        }
      }
    }

    stage('Build') {
      agent {
        docker {
          image "node:${NODE_VERSION}-alpine"
          label 'linux && docker'
          reuseNode true
        }
      }
      steps {
        script {
          parallel(
            'api tsc': {
              dir('api') { sh 'npm run build' }
            },
            'web ng build': {
              // Production configuration enforces the bundle budgets declared
              // in angular.json: an oversized initial bundle fails here.
              dir('web') { sh 'npm run build:prod' }
            },
            failFast: true
          )
        }
      }
      post {
        success {
          archiveArtifacts artifacts: 'api/dist/**, web/dist/**', fingerprint: true, onlyIfSuccessful: true
        }
      }
    }

    stage('Postman API validation') {
      when { expression { return params.RUN_E2E } }
      agent { label 'linux && docker' }
      environment {
        COMPOSE_PROJECT_NAME = "portal-ci-${BUILD_NUMBER}"
        JWT_ACCESS_SECRET    = credentials('portal-ci-jwt-access-secret')
        JWT_REFRESH_SECRET   = credentials('portal-ci-jwt-refresh-secret')
      }
      steps {
        sh '''
          set -eu
          echo "▶ Starting an ephemeral stack for API validation"
          export IMAGE_TAG=${IMAGE_TAG}
          docker compose -f docker-compose.yml up -d --build mysql api

          echo "▶ Waiting for the API readiness probe"
          for attempt in $(seq 1 40); do
            if curl -fsS http://localhost:4000/api/v1/health/ready > /dev/null 2>&1; then
              echo "  ready after ${attempt} attempt(s)"
              break
            fi
            if [ "${attempt}" = "40" ]; then
              echo "✖ API never became ready"
              docker compose logs --tail=200 api
              exit 1
            fi
            sleep 3
          done

          echo "▶ Applying migrations and seeding the demo dataset"
          docker compose --profile tools run --rm migrate

          echo "▶ Running the Postman collection with Newman"
          mkdir -p reports/newman
          docker run --rm --network host \
            -v "$PWD:/etc/newman" \
            -w /etc/newman \
            postman/newman:6-alpine \
              run postman/EmployeePortal.postman_collection.json \
              --environment postman/EmployeePortal.local.postman_environment.json \
              --env-var "baseUrl=http://localhost:4000/api/v1" \
              --reporters cli,junit,htmlextra \
              --reporter-junit-export reports/newman/junit.xml \
              --reporter-htmlextra-export reports/newman/report.html \
              --reporter-htmlextra-title "Employee Portal API — build ${BUILD_NUMBER}" \
              --timeout-request 10000 \
              --bail failure
        '''
      }
      post {
        always {
          junit testResults: 'reports/newman/junit.xml', allowEmptyResults: true
          publishHTML target: [
            reportName: 'Newman API report',
            reportDir: 'reports/newman',
            reportFiles: 'report.html',
            keepAll: true,
            alwaysLinkToLastBuild: true,
            allowMissing: true
          ]
          // Always tear the stack down, including its volumes — a leaked MySQL
          // volume would make the next build's seed step non-deterministic.
          sh 'docker compose -f docker-compose.yml down --volumes --remove-orphans || true'
        }
      }
    }

    stage('Docker build & push') {
      when {
        allOf {
          branch 'main'
          not { expression { return params.DEPLOY_ENV == 'none' } }
        }
      }
      agent { label 'linux && docker' }
      steps {
        sh '''
          set -eu
          echo "${REGISTRY_CREDS_PSW}" | docker login ghcr.io -u "${REGISTRY_CREDS_USR}" --password-stdin

          docker buildx create --use --name portal-builder 2>/dev/null || docker buildx use portal-builder

          # Both tags are pushed in one buildx invocation so the layer cache is
          # shared and `:latest` can never point at a different build than the
          # immutable SHA tag.
          docker buildx build \
            --file api/Dockerfile \
            --target runtime \
            --platform linux/amd64 \
            --cache-from type=registry,ref=${API_IMAGE}:buildcache \
            --cache-to type=registry,ref=${API_IMAGE}:buildcache,mode=max \
            --label org.opencontainers.image.revision=${GIT_COMMIT} \
            --label org.opencontainers.image.version=${IMAGE_TAG} \
            --label org.opencontainers.image.source=${GIT_URL} \
            --tag ${API_IMAGE}:${IMAGE_TAG} \
            --tag ${API_IMAGE}:latest \
            --push api

          docker buildx build \
            --file web/Dockerfile \
            --target runtime \
            --platform linux/amd64 \
            --cache-from type=registry,ref=${WEB_IMAGE}:buildcache \
            --cache-to type=registry,ref=${WEB_IMAGE}:buildcache,mode=max \
            --label org.opencontainers.image.revision=${GIT_COMMIT} \
            --label org.opencontainers.image.version=${IMAGE_TAG} \
            --tag ${WEB_IMAGE}:${IMAGE_TAG} \
            --tag ${WEB_IMAGE}:latest \
            --push web

          docker logout ghcr.io
        '''
      }
    }

    stage('Deploy to staging') {
      when {
        allOf {
          branch 'main'
          anyOf {
            expression { return params.DEPLOY_ENV == 'staging' }
            expression { return params.DEPLOY_ENV == 'production' }
          }
        }
      }
      agent { label 'linux && docker' }
      environment {
        DEPLOY_HOST = 'staging.employee-portal.internal'
        DEPLOY_USER = 'deploy'
      }
      steps {
        sshagent(credentials: ['portal-staging-ssh-key']) {
          sh '''
            set -eu
            chmod +x jenkins/scripts/deploy.sh
            ./jenkins/scripts/deploy.sh \
              --environment staging \
              --host "${DEPLOY_HOST}" \
              --user "${DEPLOY_USER}" \
              --registry "${REGISTRY}" \
              --tag "${IMAGE_TAG}" \
              --run-migrations
          '''
        }
      }
    }

    stage('Smoke tests') {
      when {
        allOf {
          branch 'main'
          anyOf {
            expression { return params.DEPLOY_ENV == 'staging' }
            expression { return params.DEPLOY_ENV == 'production' }
          }
        }
      }
      agent { label 'linux && docker' }
      steps {
        sh '''
          set -eu
          chmod +x jenkins/scripts/smoke-test.sh
          ./jenkins/scripts/smoke-test.sh \
            --base-url "https://staging.employee-portal.internal" \
            --expected-version "${IMAGE_TAG}"
        '''
      }
    }

    stage('Approve production release') {
      when {
        allOf {
          branch 'main'
          expression { return params.DEPLOY_ENV == 'production' }
        }
      }
      // No agent: the gate must not hold an executor while it waits.
      agent none
      options { timeout(time: 60, unit: 'MINUTES') }
      steps {
        script {
          def approval = input(
            id: 'ProdRelease',
            message: "Release ${IMAGE_TAG} to production?",
            ok: 'Release',
            submitter: 'release-managers,platform-leads',
            submitterParameter: 'approver',
            parameters: [
              choice(
                name: 'STRATEGY',
                choices: ['blue-green', 'rolling'],
                description: 'blue-green brings the new colour up alongside the old one, then switches nginx upstream.'
              ),
              booleanParam(
                name: 'RUN_MIGRATIONS',
                defaultValue: true,
                description: 'Apply pending Knex migrations before the switchover.'
              ),
              string(
                name: 'CHANGE_TICKET',
                defaultValue: '',
                description: 'Change record reference, recorded in the deployment log.'
              )
            ]
          )
          env.PROD_STRATEGY   = approval.STRATEGY
          env.PROD_MIGRATIONS = approval.RUN_MIGRATIONS.toString()
          env.PROD_APPROVER   = approval.approver
          env.CHANGE_TICKET   = approval.CHANGE_TICKET

          echo "Approved by ${env.PROD_APPROVER} · strategy=${env.PROD_STRATEGY} · ticket=${env.CHANGE_TICKET ?: 'none'}"
        }
      }
    }

    stage('Deploy to production') {
      when {
        allOf {
          branch 'main'
          expression { return params.DEPLOY_ENV == 'production' }
        }
      }
      agent { label 'linux && docker' }
      environment {
        DEPLOY_HOST = 'portal.example.com'
        DEPLOY_USER = 'deploy'
      }
      steps {
        sshagent(credentials: ['portal-production-ssh-key']) {
          sh '''
            set -eu
            chmod +x jenkins/scripts/deploy.sh
            ./jenkins/scripts/deploy.sh \
              --environment production \
              --host "${DEPLOY_HOST}" \
              --user "${DEPLOY_USER}" \
              --registry "${REGISTRY}" \
              --tag "${IMAGE_TAG}" \
              --strategy "${PROD_STRATEGY}" \
              ${PROD_MIGRATIONS:+--run-migrations}
          '''
        }
        sh '''
          set -eu
          ./jenkins/scripts/smoke-test.sh \
            --base-url "https://portal.example.com" \
            --expected-version "${IMAGE_TAG}"
        '''
      }
      post {
        failure {
          echo '✖ Production verification failed — rolling back to the previous colour'
          sshagent(credentials: ['portal-production-ssh-key']) {
            sh '''
              ./jenkins/scripts/deploy.sh \
                --environment production \
                --host "portal.example.com" \
                --user "deploy" \
                --registry "${REGISTRY}" \
                --rollback
            '''
          }
        }
      }
    }
  }

  post {
    always {
      node('linux && docker') {
        archiveArtifacts artifacts: 'reports/**', allowEmptyArchive: true, fingerprint: false
        cleanWs(deleteDirs: true, notFailBuild: true, patterns: [[pattern: '**/node_modules/**', type: 'EXCLUDE']])
      }
    }
    success {
      slackSend(
        channel: env.SLACK_CHANNEL,
        color: 'good',
        message: """✅ *${env.JOB_NAME}* #${env.BUILD_NUMBER} passed
• commit `${env.GIT_SHORT}` — ${env.GIT_SUBJECT}
• images pushed as `${env.IMAGE_TAG}`
• target: ${params.DEPLOY_ENV}${env.PROD_APPROVER ? " (approved by ${env.PROD_APPROVER})" : ''}
<${env.BUILD_URL}|Open build>"""
      )
    }
    unstable {
      slackSend(
        channel: env.SLACK_CHANNEL,
        color: 'warning',
        message: "⚠️ *${env.JOB_NAME}* #${env.BUILD_NUMBER} is unstable — coverage or test thresholds slipped. <${env.BUILD_URL}testReport|Test report>"
      )
    }
    failure {
      slackSend(
        channel: env.SLACK_CHANNEL,
        color: 'danger',
        message: """❌ *${env.JOB_NAME}* #${env.BUILD_NUMBER} failed at stage *${env.STAGE_NAME}*
• commit `${env.GIT_SHORT}` by ${env.GIT_AUTHOR}
<${env.BUILD_URL}console|Console log>"""
      )
      emailext(
        to: env.NOTIFY_EMAIL ?: 'team@example.com',
        subject: "[FAILED] ${env.JOB_NAME} #${env.BUILD_NUMBER}",
        body: '''$DEFAULT_CONTENT''',
        attachLog: true,
        compressLog: true
      )
    }
    aborted {
      slackSend(
        channel: env.SLACK_CHANNEL,
        color: '#808080',
        message: "⏹ *${env.JOB_NAME}* #${env.BUILD_NUMBER} aborted — most likely the production approval timed out."
      )
    }
  }
}
