export function buildJiraIssueDocument(issue, context = {}) {
  const fields = issue.fields || {};

  return {
    id: issue.id,
    key: issue.key,
    jira_base_url: context.baseUrl,
    entity_type: "jira_issue",
    ingested_at: new Date().toISOString(),
    summary: fields.summary || null,
    created_at: fields.created || null,
    updated_at: fields.updated || null,
    resolution_date: fields.resolutiondate || null,
    project: simplifyProject(fields.project),
    issue_type: simplifyIssueType(fields.issuetype),
    status: simplifyStatus(fields.status),
    parent: simplifyParent(fields.parent),
    assignee: simplifyUser(fields.assignee),
    reporter: simplifyUser(fields.reporter),
    creator: simplifyUser(fields.creator),
    labels: fields.labels || [],
    components: (fields.components || []).map((component) => component.name),
    fix_versions: (fields.fixVersions || []).map((version) => version.name),
    comment_count: fields.comment?.total || 0,
  };
}

function simplifyProject(project) {
  if (!project) {
    return null;
  }

  return {
    id: project.id,
    key: project.key,
    name: project.name,
    project_type_key: project.projectTypeKey,
    simplified: project.simplified,
    category_name: project.projectCategory?.name || null,
  };
}

function simplifyIssueType(issueType) {
  if (!issueType) {
    return null;
  }

  return {
    id: issueType.id,
    name: issueType.name,
    subtask: issueType.subtask,
    hierarchy_level: issueType.hierarchyLevel,
  };
}

function simplifyStatus(status) {
  if (!status) {
    return null;
  }

  return {
    id: status.id,
    name: status.name,
    category_key: status.statusCategory?.key || null,
    category_name: status.statusCategory?.name || null,
  };
}

function simplifyParent(parent) {
  if (!parent) {
    return null;
  }

  return {
    id: parent.id,
    key: parent.key,
    summary: parent.fields?.summary || null,
    status_name: parent.fields?.status?.name || null,
    issue_type_name: parent.fields?.issuetype?.name || null,
  };
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

