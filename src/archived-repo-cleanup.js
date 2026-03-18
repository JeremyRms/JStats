export const ARCHIVED_REPO_INDICES = [
  "jstats-repository",
  "jstats-teams",
  "jstats-pullrequest",
  "jstats-review",
  "jstats-comment",
];

export function buildArchivedRepoQuery(repositoryNames = []) {
  return {
    query: {
      terms: {
        "repository.keyword": repositoryNames,
      },
    },
  };
}

export function collectArchivedRepositoryNames(repositories = []) {
  return repositories
    .filter((repository) => repository?.archived && repository?.name)
    .map((repository) => repository.name)
    .sort((left, right) => left.localeCompare(right));
}

export function parseBooleanFlag(value, defaultValue = false) {
  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }

  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "n", "off"].includes(normalized)) {
    return false;
  }

  throw new Error(`Invalid boolean flag: ${value}`);
}

