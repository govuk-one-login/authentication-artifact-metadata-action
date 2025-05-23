import * as core from '@actions/core'
import * as github from '@actions/github'

import { Shescape } from 'shescape'

import { PRMetadata, PRNode, QueryResponse } from './types.js'

const query = `query ($owner: String!, $name: String!, $oid: GitObjectID!) {
  repository(owner: $owner, name: $name) {
    object(oid: $oid) {
      ... on Commit {
        oid
        message
        associatedPullRequests(first: 1) {
          nodes {
            number
            title
            merged
            mergedAt
            mergeCommit {
              oid
            }
          }
        }
      }
    }
    owner {
      login
    }
    name
    nameWithOwner
  }
}`

function getGraphqlVariables(): Record<string, string> {
  const { owner, repo } = github.context.repo
  const oid = github.context.sha

  return { owner, name: repo, oid }
}

function sanitizeField(value?: string): string {
  if (value == undefined) {
    return ''
  }
  // strip non-ascii characters
  return value.replace(/[^\x20-\x7E]/g, '')
}

function createInitialMetadata(response: QueryResponse): PRMetadata {
  const firstLineOfCommitMessage =
    response.repository.object.message.split('\n')[0]

  const shortCommitSha = github.context.sha.substring(0, 7)

  return {
    pr_number: undefined,
    pr_title: undefined,
    pr_merged_at: undefined,
    pr_merge_commit_sha: undefined,

    commit_message: sanitizeField(firstLineOfCommitMessage),

    repo_full_name: sanitizeField(response.repository.nameWithOwner),
    repo_owner: sanitizeField(response.repository.owner.login),
    repo_name: sanitizeField(response.repository.name),

    repository: sanitizeField(response.repository.nameWithOwner),
    commitsha: sanitizeField(github.context.sha),
    commitmessage: sanitizeField(firstLineOfCommitMessage),

    'codepipeline-artifact-revision-summary': sanitizeField(
      `${shortCommitSha}: ${firstLineOfCommitMessage}`
    )
  }
}

function updateMetadataFromPR(metadata: PRMetadata, pr: PRNode): void {
  const shortMergeCommitSha = pr.mergeCommit.oid.substring(0, 7)

  metadata.pr_number = sanitizeField(pr.number.toString())
  metadata.pr_title = sanitizeField(pr.title)
  metadata.pr_merged_at = sanitizeField(pr.mergedAt)
  metadata.pr_merge_commit_sha = sanitizeField(pr.mergeCommit.oid)
  metadata.commitmessage = sanitizeField(pr.title)
  metadata['codepipeline-artifact-revision-summary'] = sanitizeField(
    `${shortMergeCommitSha}: #${pr.number} (${metadata.repo_full_name}) - ${pr.title}`
  )
}

/**
 * The main function for the action.
 * @returns {Promise<void>} Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  try {
    const octokit = github.getOctokit(core.getInput('github-token'))

    const graphQlResponse: QueryResponse = await octokit.graphql(
      query,
      getGraphqlVariables()
    )

    const metadata = createInitialMetadata(graphQlResponse)
    const prNodes =
      graphQlResponse.repository.object.associatedPullRequests.nodes

    if (prNodes.length > 0 && prNodes[0].merged) {
      updateMetadataFromPR(metadata, prNodes[0])
    }

    if (metadata['codepipeline-artifact-revision-summary'].length > 2048) {
      metadata['codepipeline-artifact-revision-summary'] = metadata[
        'codepipeline-artifact-revision-summary'
      ].substring(0, 2048)
    }

    const outputJson = JSON.stringify(metadata, null, 2)
    core.setOutput('json', outputJson)
    console.log(outputJson)

    const shell = core.getInput('shell')
    if (shell) {
      const shescape = new Shescape({ shell })
      const escapedMetadata = shescape.quote(JSON.stringify(metadata))
      core.setOutput('shell', shell)
      core.setOutput('escaped-json', escapedMetadata)
      console.log(escapedMetadata)
    }
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) core.setFailed(error.message)
  }
}
