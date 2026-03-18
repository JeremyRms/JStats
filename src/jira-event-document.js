export function buildCreatedEventDocument(issue, context = {}) {
  return {
    id: `${issue.id}:created`,
    jira_base_url: context.baseUrl,
    entity_type: "jira_event",
    event_type: "created",
    event_timestamp: issue.fields?.created || null,
    ingested_at: new Date().toISOString(),
    issue_id: issue.id,
    issue_key: issue.key,
    issue_summary: issue.fields?.summary || null,
    project_key: issue.fields?.project?.key || null,
    project_name: issue.fields?.project?.name || null,
    actor: simplifyUser(issue.fields?.creator),
    changed_fields: [],
  };
}

export function buildHistoryEventDocuments(issue, history, statusCategoryById, context = {}) {
  const docs = [];
  const items = history.items || [];
  const changedFields = items.map((item) => item.field).filter(Boolean);
  const completedStatusItem = items.find((item) => {
    if (item.field !== "status" || !item.to) {
      return false;
    }
    return statusCategoryById.get(String(item.to)) === "done";
  });

  const hasNonCompletionChange = items.some((item) => {
    if (item.field !== "status") {
      return true;
    }
    if (!item.to) {
      return true;
    }
    return statusCategoryById.get(String(item.to)) !== "done";
  });

  if (hasNonCompletionChange) {
    docs.push({
      id: `${issue.id}:updated:${history.id}`,
      jira_base_url: context.baseUrl,
      entity_type: "jira_event",
      event_type: "updated",
      event_timestamp: history.created,
      ingested_at: new Date().toISOString(),
      issue_id: issue.id,
      issue_key: issue.key,
      issue_summary: issue.fields?.summary || null,
      project_key: issue.fields?.project?.key || null,
      project_name: issue.fields?.project?.name || null,
      actor: simplifyUser(history.author),
      changelog_id: history.id,
      changed_fields: changedFields,
    });
  }

  if (completedStatusItem) {
    docs.push({
      id: `${issue.id}:completed:${history.id}`,
      jira_base_url: context.baseUrl,
      entity_type: "jira_event",
      event_type: "completed",
      event_timestamp: history.created,
      ingested_at: new Date().toISOString(),
      issue_id: issue.id,
      issue_key: issue.key,
      issue_summary: issue.fields?.summary || null,
      project_key: issue.fields?.project?.key || null,
      project_name: issue.fields?.project?.name || null,
      actor: simplifyUser(history.author),
      changelog_id: history.id,
      changed_fields: changedFields,
      status_from: completedStatusItem.fromString || null,
      status_to: completedStatusItem.toString || null,
      status_to_category_key: statusCategoryById.get(String(completedStatusItem.to)) || null,
    });
  }

  return docs;
}

export function buildStatusCategoryById(statusesPayload = []) {
  const map = new Map();
  for (const entry of statusesPayload) {
    if (Array.isArray(entry?.statuses)) {
      for (const status of entry.statuses) {
        map.set(String(status.id), normalizeStatusCategoryKey(status.statusCategory));
      }
      continue;
    }

    map.set(String(entry.id), normalizeStatusCategoryKey(entry.statusCategory));
  }
  return map;
}

function normalizeStatusCategoryKey(statusCategory) {
  if (!statusCategory) {
    return null;
  }

  if (typeof statusCategory === "string") {
    return statusCategory.toLowerCase();
  }

  return statusCategory.key || null;
}

function simplifyUser(user) {
  if (!user) {
    return null;
  }

  return {
    account_id: user.accountId,
    display_name: user.displayName,
    active: user.active,
    account_type: user.accountType,
  };
}
