/**
 * Job DSL seed script — jobs as code.
 *
 * Run by the `seed-employee-portal` freestyle job (Process Job DSLs → look on
 * filesystem → jenkins/seed-job.groovy). Re-running it is safe: existing jobs
 * are updated in place rather than duplicated, which is the whole point of
 * keeping the job definitions in the repository next to the pipeline they run.
 */

final String REPO = '<owner>/enterprise-employee-portal'
final String FOLDER = 'employee-portal'

folder(FOLDER) {
    displayName('Enterprise Employee Portal')
    description('Angular 18 + Express + MySQL 8 HR self-service portal. Pipelines defined in the repository Jenkinsfile.')
}

// ---------------------------------------------------------------------------
// Main multibranch pipeline: builds main and every pull request.
// ---------------------------------------------------------------------------
multibranchPipelineJob("${FOLDER}/portal-ci") {
    displayName('portal-ci (multibranch)')
    description('Full verification pipeline. Only `main` builds images and can reach the deployment stages.')

    branchSources {
        github {
            id('portal-github-source')
            repoOwner(REPO.tokenize('/')[0])
            repository(REPO.tokenize('/')[1])
            scanCredentialsId('portal-github-token')
            buildOriginBranch(true)
            buildOriginBranchWithPR(false)
            buildOriginPRMerge(true)
            buildForkPRMerge(false)
        }
    }

    configure { node ->
        // Clean before checkout — a stale dist/ or node_modules from a previous
        // branch is a classic source of "works on the agent" failures.
        node / sources / data / 'jenkins.branch.BranchSource' / source / traits <<
            'jenkins.plugins.git.traits.CleanBeforeCheckoutTrait' {
                extension(class: 'hudson.plugins.git.extensions.impl.CleanBeforeCheckout')
            }
    }

    factory {
        workflowBranchProjectFactory {
            scriptPath('Jenkinsfile')
        }
    }

    orphanedItemStrategy {
        discardOldItems {
            numToKeep(10)
            daysToKeep(30)
        }
    }

    triggers {
        periodicFolderTrigger {
            interval('1d') // fallback if the GitHub webhook is missed
        }
    }
}

// ---------------------------------------------------------------------------
// Nightly verification against main, with the full Newman suite.
// ---------------------------------------------------------------------------
pipelineJob("${FOLDER}/portal-nightly") {
    displayName('portal-nightly')
    description('Nightly run of main with API validation enabled and no deployment. Catches drift in transitive dependencies and in the seeded dataset.')

    parameters {
        choiceParam('DEPLOY_ENV', ['none'], 'Nightly never deploys.')
        booleanParam('RUN_E2E', true, 'Always run the Postman suite.')
        booleanParam('SKIP_QUALITY_GATE', false, '')
    }

    definition {
        cpsScm {
            scm {
                git {
                    remote {
                        github(REPO)
                        credentials('portal-github-token')
                    }
                    branch('main')
                }
            }
            scriptPath('Jenkinsfile')
            lightweight(true)
        }
    }

    triggers {
        cron('H 2 * * 1-5') // weeknights, spread across the hour
    }

    logRotator {
        numToKeep(30)
        daysToKeep(60)
    }
}

// ---------------------------------------------------------------------------
// Manual production release: same Jenkinsfile, pre-set parameters.
// ---------------------------------------------------------------------------
pipelineJob("${FOLDER}/portal-release-production") {
    displayName('portal-release-production')
    description('Promotes the current main to production. Still passes through the in-pipeline manual approval gate — this job only pre-selects the parameters.')

    parameters {
        choiceParam('DEPLOY_ENV', ['production'], 'Fixed for this job.')
        booleanParam('RUN_E2E', true, 'Re-verify the API before promoting.')
        booleanParam('SKIP_QUALITY_GATE', false, 'Break glass only.')
    }

    definition {
        cpsScm {
            scm {
                git {
                    remote {
                        github(REPO)
                        credentials('portal-github-token')
                    }
                    branch('main')
                }
            }
            scriptPath('Jenkinsfile')
            lightweight(true)
        }
    }

    properties {
        disableConcurrentBuilds()
    }

    logRotator {
        numToKeep(50)
        artifactNumToKeep(10)
    }
}

// ---------------------------------------------------------------------------
// Housekeeping: prune the agents' Docker caches so the layer cache from the
// buildx stage cannot silently fill the disk.
// ---------------------------------------------------------------------------
job("${FOLDER}/portal-agent-housekeeping") {
    displayName('portal-agent-housekeeping')
    description('Weekly Docker prune on the build agents.')

    label('linux && docker')

    triggers {
        cron('H 4 * * 0')
    }

    steps {
        shell('''
            set -eu
            docker system prune -af --filter "until=168h"
            docker volume prune -f
            docker buildx du || true
        '''.stripIndent().trim())
    }

    logRotator {
        numToKeep(15)
    }
}
