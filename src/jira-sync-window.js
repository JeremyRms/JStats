export function resolveJiraSyncWindow(env = process.env) {
  const year = env.JIRA_SYNC_YEAR?.trim();
  if (!year) {
    return null;
  }

  if (!/^\d{4}$/.test(year)) {
    throw new Error(`Invalid JIRA_SYNC_YEAR: ${year}`);
  }

  const start = `${year}-01-01`;
  const end = `${Number.parseInt(year, 10) + 1}-01-01`;

  return {
    year,
    start,
    end,
    updatedJql: `updated >= "${start}" AND updated < "${end}"`,
  };
}

export function appendJqlClauses(...clauses) {
  return clauses
    .map((clause) => clause?.trim())
    .filter(Boolean)
    .join(" AND ");
}

export function isTimestampInWindow(timestamp, window) {
  if (!timestamp) {
    return false;
  }
  if (!window) {
    return true;
  }

  const value = Date.parse(timestamp);
  if (Number.isNaN(value)) {
    return false;
  }

  return (
    value >= Date.parse(`${window.start}T00:00:00.000Z`) &&
    value < Date.parse(`${window.end}T00:00:00.000Z`)
  );
}

export function sortDocumentsByTimestampDesc(documents = []) {
  return [...documents].sort((left, right) => {
    const leftTime = Date.parse(left.event_timestamp || 0);
    const rightTime = Date.parse(right.event_timestamp || 0);
    return rightTime - leftTime;
  });
}
