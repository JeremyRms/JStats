import * as fs from "fs";
import * as path from "path";

const DEFAULT_STATE = {
  version: 1,
  repos: {},
  jira_sync: {},
};

export function loadState(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return { ...DEFAULT_STATE };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    const repos = parsed?.repos && typeof parsed.repos === "object" ? parsed.repos : {};
    const jiraSync =
      parsed?.jira_sync && typeof parsed.jira_sync === "object" ? parsed.jira_sync : {};

    return {
      ...DEFAULT_STATE,
      ...parsed,
      repos,
      jira_sync: jiraSync,
    };
  } catch (error) {
    console.warn(`Unable to parse state file ${filePath}, using defaults`, error);
    return { ...DEFAULT_STATE };
  }
}

export function saveState(filePath, state) {
  const dir = path.dirname(filePath);
  if (dir && dir !== ".") {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
}

export function getRepoPullWatermark(state, repositoryName) {
  return state?.repos?.[repositoryName]?.last_pull_updated_at;
}

export function setRepoPullWatermark(state, repositoryName, watermark) {
  if (!state.repos[repositoryName]) {
    state.repos[repositoryName] = {};
  }

  state.repos[repositoryName].last_pull_updated_at = watermark;
  state.repos[repositoryName].last_run_at = new Date().toISOString();
}

export function removeRepos(state, repositoryNames = []) {
  let removed = 0;

  for (const repositoryName of repositoryNames) {
    if (state?.repos?.[repositoryName]) {
      delete state.repos[repositoryName];
      removed += 1;
    }
  }

  return removed;
}
