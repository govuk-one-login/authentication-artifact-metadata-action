type PRNode = {
  number: number
  title: string
  merged: boolean
  mergedAt: string
  mergeCommit: {
    oid: string
  }
}

type QueryResponse = {
  repository: {
    name: string
    nameWithOwner: string
    object: {
      oid: string
      message: string
      associatedPullRequests: {
        nodes: PRNode[]
      }
    }
    owner: {
      login: string
    }
  }
}

type PRMetadata = {
  pr_number?: string
  pr_title?: string
  pr_merged_at?: string
  pr_merge_commit_sha?: string

  commit_message: string

  repo_full_name: string
  repo_owner: string
  repo_name: string

  repository: string
  commitsha: string
  commitmessage: string

  'codepipeline-artifact-revision-summary': string
}

export { QueryResponse, PRMetadata, PRNode }
