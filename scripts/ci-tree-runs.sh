# Receipts of the checked-out tree, sourced by CI's and Signal's verification steps.
# Reads only the newest page; older receipts are a safe miss, never a history scan.

# tree_runs WORKFLOW BRANCH STATUS prints the push runs of WORKFLOW on BRANCH whose head commit has
# this checkout's tree. STATUS is success (completed and green) or a pending status
# (in_progress, queued); a red or cancelled run never matches success.
tree_runs() {
  local tree
  tree=$(git rev-parse 'HEAD^{tree}')
  TREE_ID=$tree RUN_BRANCH=$2 RUN_STATUS=$3 gh api "repos/${GITHUB_REPOSITORY}/actions/workflows/$1/runs?branch=$2&event=push&status=$3&per_page=100" --jq '
    .workflow_runs[]
    | select(.head_branch == env.RUN_BRANCH and .event == "push")
    | select(.status == env.RUN_STATUS or (.status == "completed" and .conclusion == env.RUN_STATUS))
    | select(.head_commit.id == .head_sha and .head_commit.tree_id == env.TREE_ID)
    | .id'
}

# ran_in_full RUN JOB succeeds when RUN's JOB succeeded. A reuse skips JOB, so reuse never rests on
# another reuse.
ran_in_full() {
  local ran
  ran=$(JOB_NAME=$2 gh api "repos/${GITHUB_REPOSITORY}/actions/runs/$1/jobs?per_page=100" --jq '
    [.jobs[] | select(.name == env.JOB_NAME and .conclusion == "success")] | length')
  [[ "$ran" =~ ^[1-9] ]]
}
