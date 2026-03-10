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
