export function buildJiraSyncSignature(context = {}) {
  return JSON.stringify({
    organization: context.organization || null,
    baseUrl: context.baseUrl || null,
    searchJql: context.searchJql || "",
    projectKeys: [...(context.projectKeys || [])].sort(),
    syncYear: context.syncYear || null,
    paginationMode: context.paginationMode || null,
  });
}

export function getJiraSyncCheckpoint(state, syncType, signature) {
  const checkpoint = state?.jira_sync?.[syncType];
  if (!checkpoint || checkpoint.signature !== signature) {
    return null;
  }

  return checkpoint;
}

export function setJiraSyncCheckpoint(state, syncType, signature, checkpoint = {}) {
  if (!state.jira_sync) {
    state.jira_sync = {};
  }

  state.jira_sync[syncType] = {
    ...checkpoint,
    signature,
    updated_at: new Date().toISOString(),
  };
}

export function clearJiraSyncCheckpoint(state, syncType) {
  if (!state?.jira_sync?.[syncType]) {
    return false;
  }

  delete state.jira_sync[syncType];
  return true;
}
