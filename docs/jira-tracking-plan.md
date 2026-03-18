# Jira Tracking Plan

This file records the initial Jira tracking scope before ingestion is implemented.

## Tracked projects

Only a subset of Jira projects should be ingested.

Project keys to track:

- `ARCH`
- `BROK`
- `DEVOPS`
- `ENG`
- `INFR`
- `MAR`

Use `JIRA_PROJECT_KEYS` in `.env` for the actual runtime list.

Example:

```bash
JIRA_PROJECT_KEYS=ARCH,BROK,DEVOPS,ENG,INFR,MAR
```

## Work event categories

We want Jira work to be separated into four event types:

1. `created`
   Triggered from issue creation time.
   Base field candidate: `created`.

2. `updated`
   Triggered from issue updates after creation.
   Base source candidate: changelog history.
   Excludes the initial create event.
   Current modeling rule: emit one `updated` event for each changelog history that is not only a transition into a `done` status category.

3. `commented`
   Triggered from issue comments.
   Base source candidate: issue comments endpoint / comment payloads.
   Should remain separate from generic field/status updates.

4. `completed`
   Triggered when an issue moves into a done/completed state.
   Base field candidates: status transition changelog and `resolutiondate`.
   Current modeling rule: emit one `completed` event for each changelog history whose `status` change moves to a status category of `done`.

## Notes

- Completion should be modeled separately from generic updates.
- Comments should be modeled separately from generic updates.
- Project filtering should happen before indexing.
- Final JQL is still to be defined.
- Reopened issues can produce multiple `completed` events over time if they move into `done` more than once.
