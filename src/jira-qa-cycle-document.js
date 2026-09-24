const DEFAULT_QA_STATUSES = ["in qa", "qa", "testing"];

export function resolveQaStatuses(env = process.env) {
  const raw = env.JIRA_QA_STATUSES;
  const names = raw
    ? raw
        .split(",")
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean)
    : DEFAULT_QA_STATUSES;

  if (names.length === 0) {
    throw new Error("JIRA_QA_STATUSES resolved to an empty status list");
  }

  return new Set(names);
}

export function buildQaCycleDocument(issue, histories = [], qaStatuses, context = {}) {
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
        from: item.fromString || null,
        to: item.toString || null,
      });
    }
  }

  let qaStartedAt = null;
  let qaEndedAt = null;
  let qaEndStatus = null;

  for (const transition of transitions) {
    const toQa = qaStatuses.has((transition.to || "").toLowerCase());
    const fromQa = qaStatuses.has((transition.from || "").toLowerCase());

    if (!qaStartedAt) {
      if (toQa) {
        qaStartedAt = transition.at;
      }
      continue;
    }

    if (!qaEndedAt && fromQa && !toQa) {
      qaEndedAt = transition.at;
      qaEndStatus = transition.to;
      break;
    }
  }

  if (!qaStartedAt) {
    return null;
  }

  const qaCycleSeconds = qaEndedAt
    ? Math.max(
        0,
        Math.round((Date.parse(qaEndedAt) - Date.parse(qaStartedAt)) / 1000)
      )
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
      qaCycleSeconds === null
        ? null
        : Math.round((qaCycleSeconds / 86400) * 100) / 100,
    qa_open: !qaEndedAt,
    url: context.baseUrl ? `${context.baseUrl}/browse/${issue.key}` : null,
  };
}
