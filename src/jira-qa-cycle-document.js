// QA cycle metric.
//
// One document per issue that reached QA. It measures the QA stage of the
// release process: how long an issue sat in QA, and how many times QA sent it
// back to development. The release process treats QA as the constraint, so
// these two numbers are how we tell whether the constraint is easing.
//
// Statuses fall into four groups, all matched without case sensitivity:
//   QA        the issue is in QA (queue or active). Configurable, because the
//             instance uses several spellings.
//   FORWARD   the issue left QA accepted or shipped. These end the cycle.
//   CANCELLED the issue left QA because it was dropped. Not a pass, but not a
//             rework either, so it ends the cycle without counting as a bounce.
//   backward  anything else an issue can move to from QA. This is development
//             taking the issue back, which is a bounce.
//
// A backward move is defined by exclusion (not QA, not forward, not cancelled)
// so a new development-side status is never silently treated as a pass.

const DEFAULT_QA_STATUSES = ["in qa", "qa", "testing"];
const DEFAULT_FORWARD_STATUSES = [
  "passed qa",
  "pending release",
  "done",
  "released",
  "closed",
  "resolved",
];
const DEFAULT_CANCELLED_STATUSES = ["won't do", "will not do", "cancelled"];

export function resolveQaStatuses(env = process.env) {
  return resolveStatusSet(env.JIRA_QA_STATUSES, DEFAULT_QA_STATUSES, "JIRA_QA_STATUSES");
}

export function resolveForwardStatuses(env = process.env) {
  return resolveStatusSet(
    env.JIRA_QA_FORWARD_STATUSES,
    DEFAULT_FORWARD_STATUSES,
    "JIRA_QA_FORWARD_STATUSES"
  );
}

export function resolveCancelledStatuses(env = process.env) {
  return resolveStatusSet(
    env.JIRA_QA_CANCELLED_STATUSES,
    DEFAULT_CANCELLED_STATUSES,
    "JIRA_QA_CANCELLED_STATUSES"
  );
}

function resolveStatusSet(raw, fallback, label) {
  const names = raw
    ? raw.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean)
    : fallback;

  if (names.length === 0) {
    throw new Error(`${label} resolved to an empty status list`);
  }

  return new Set(names);
}

export function buildQaCycleDocument(issue, histories = [], qaStatuses, context = {}) {
  const forwardStatuses = context.forwardStatuses || resolveForwardStatuses();
  const cancelledStatuses = context.cancelledStatuses || resolveCancelledStatuses();

  // Flatten the changelog to status transitions, oldest first, so the walk
  // sees the issue move through its statuses in the order they happened.
  const transitions = [];
  const sortedHistories = [...histories].sort(
    (left, right) => Date.parse(left.created) - Date.parse(right.created)
  );
  for (const history of sortedHistories) {
    for (const item of history.items || []) {
      if (item.field !== "status") {
        continue;
      }
      transitions.push({
        at: history.created,
        from: (item.fromString || "").toLowerCase(),
        to: (item.toString || "").toLowerCase(),
        toLabel: item.toString || null,
      });
    }
  }

  let qaStartedAt = null; // first time the issue entered QA
  let qaEndedAt = null; // first time it left QA forward or was cancelled
  let qaEndStatus = null; // the status it moved to on that ending exit
  let qaEntries = 0; // number of times it entered QA (visits)
  let qaBounces = 0; // number of times QA sent it back to development
  let inQa = false;

  for (const transition of transitions) {
    const fromQa = qaStatuses.has(transition.from);
    const toQa = qaStatuses.has(transition.to);

    // Entry: a move from any non-QA status into a QA status.
    if (!fromQa && toQa) {
      qaEntries += 1;
      inQa = true;
      if (!qaStartedAt) {
        qaStartedAt = transition.at;
      }
      continue;
    }

    // Exit: a move out of QA. Only meaningful once the issue is in QA.
    if (fromQa && !toQa) {
      inQa = false;
      const forward = forwardStatuses.has(transition.to);
      const cancelled = cancelledStatuses.has(transition.to);

      if (forward || cancelled) {
        // The cycle ends at the first forward or cancelled exit. Later
        // re-entries would be a reopen, which is out of scope here.
        if (!qaEndedAt) {
          qaEndedAt = transition.at;
          qaEndStatus = transition.toLabel;
        }
      } else {
        // Neither forward nor cancelled means development took it back.
        qaBounces += 1;
      }
    }
  }

  if (!qaStartedAt) {
    return null; // issue never reached QA, so there is no cycle to record
  }

  // Cycle time is the calendar span from the first handover into QA to the
  // ending exit. This matches "from handover to leaving QA entirely", so a
  // cycle that bounced spans all of its QA time, not just the first visit.
  const qaCycleSeconds = qaEndedAt
    ? Math.max(0, Math.round((Date.parse(qaEndedAt) - Date.parse(qaStartedAt)) / 1000))
    : null;

  return {
    id: `qa-cycle-${issue.key}`,
    entity_type: "jira_qa_cycle",
    issue_key: issue.key,
    issue_id: issue.id || null,
    project_key: issue.fields?.project?.key || null,
    issue_type: issue.fields?.issuetype?.name || null,
    summary: issue.fields?.summary || null,
    story_points: issue.fields?.customfield_10004 ?? null,
    fix_versions: (issue.fields?.fixVersions || [])
      .map((version) => version?.name)
      .filter(Boolean),
    assignee: issue.fields?.assignee?.displayName || null,
    qa_started_at: new Date(Date.parse(qaStartedAt)).toISOString(),
    qa_ended_at: qaEndedAt ? new Date(Date.parse(qaEndedAt)).toISOString() : null,
    qa_end_status: qaEndStatus,
    qa_cycle_seconds: qaCycleSeconds,
    qa_cycle_days:
      qaCycleSeconds === null ? null : Math.round((qaCycleSeconds / 86400) * 100) / 100,
    // qa_entries counts QA visits; qa_bounces counts how many of the exits went
    // back to development. qa_bounced is the per-issue rework flag. The rework
    // rate is the share of QA issues with qa_bounced true, and the total bounce
    // count is the sum of qa_bounces.
    qa_entries: qaEntries,
    qa_bounces: qaBounces,
    qa_bounced: qaBounces > 0,
    // qa_open means the issue is still in QA now, so its cycle has not ended.
    qa_open: inQa && !qaEndedAt,
    url: context.baseUrl ? `${context.baseUrl}/browse/${issue.key}` : null,
  };
}
