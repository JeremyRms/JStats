export function enrichDocument(document, context = {}) {
  if (!document || typeof document !== "object") {
    return document;
  }

  const now = new Date().toISOString();

  document.ingested_at = now;

  if (context.organization) {
    document.organization = context.organization;
  }

  if (context.repository) {
    document.repository = context.repository;
  }

  if (context.entityType) {
    document.entity_type = context.entityType;
  }

  if (context.pullRequestId !== undefined) {
    document.pull_request_id = context.pullRequestId;
  }

  if (context.pullRequestNumber !== undefined) {
    document.pull_request_number = context.pullRequestNumber;
  }

  const actorType = document?.user?.type;
  if (typeof actorType === "string") {
    document.actor_is_bot = actorType.toLowerCase() === "bot";
  }

  return document;
}

export function enrichPullRequestMetrics(pullRequest, reviews = []) {
  if (!pullRequest || typeof pullRequest !== "object") {
    return pullRequest;
  }

  const additions = pullRequest?.diff?.additions;
  const deletions = pullRequest?.diff?.deletions;
  if (Number.isFinite(additions) && Number.isFinite(deletions)) {
    pullRequest.pr_size = additions + deletions;
  }

  const changedFiles = pullRequest?.diff?.changed_files;
  if (Number.isFinite(changedFiles)) {
    pullRequest.pr_changed_files = changedFiles;
  }

  const createdAt = Date.parse(pullRequest.created_at);
  const mergedAt = Date.parse(pullRequest.merged_at);
  if (Number.isFinite(createdAt) && Number.isFinite(mergedAt)) {
    pullRequest.merge_lead_time_seconds = Math.max(
      0,
      Math.round((mergedAt - createdAt) / 1000)
    );
    // Field name matches the existing "Avg merge lead time / week" lens
    pullRequest.pr_time_to_merge_days = roundTo(
      pullRequest.merge_lead_time_seconds / 86400,
      2
    );
  }

  const authorId = pullRequest?.user?.id;
  let firstReviewAt = null;
  for (const review of reviews) {
    const submittedAt = Date.parse(review?.submitted_at);
    if (!Number.isFinite(submittedAt)) {
      continue;
    }
    // Self-reviews (author commenting via the review flow) are not review latency
    if (authorId !== undefined && review?.user?.id === authorId) {
      continue;
    }
    if (firstReviewAt === null || submittedAt < firstReviewAt) {
      firstReviewAt = submittedAt;
    }
  }

  if (firstReviewAt !== null) {
    pullRequest.first_review_submitted_at = new Date(firstReviewAt).toISOString();
    if (Number.isFinite(createdAt)) {
      pullRequest.first_review_latency_seconds = Math.max(
        0,
        Math.round((firstReviewAt - createdAt) / 1000)
      );
      pullRequest.first_review_latency_hours = roundTo(
        pullRequest.first_review_latency_seconds / 3600,
        2
      );
    }
  }

  return pullRequest;
}

function roundTo(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function enrichPullRequestCheckRuns(
  pullRequest,
  checkRuns = [],
  contractTestPattern = ""
) {
  if (!pullRequest || typeof pullRequest !== "object") {
    return pullRequest;
  }

  const summaries = checkRuns.map((run) => ({
    name: run?.name || null,
    status: run?.status || null,
    conclusion: run?.conclusion ?? null,
    completed_at: run?.completed_at ?? null,
  }));

  pullRequest.check_runs = summaries;
  pullRequest.check_run_count = summaries.length;

  if (contractTestPattern) {
    const pattern = new RegExp(contractTestPattern, "i");
    const contractRuns = summaries.filter(
      (run) => run.name && pattern.test(run.name)
    );
    pullRequest.contract_test_check_present = contractRuns.length > 0;
    pullRequest.contract_test_check_passed = contractRuns.some(
      (run) => run.conclusion === "success"
    );
  }

  return pullRequest;
}
