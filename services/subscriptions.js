// Legacy subscriptions have no revision. Include their creation time and
// configuration so a check can still safely merge without overwriting edits.
export function subscriptionRevision(subscription) {
  if (!subscription) return "";
  return subscription.revision || JSON.stringify([
    subscription.createdAt, subscription.creatorId, subscription.mode,
    subscription.section?.type, subscription.section?.id, subscription.section?.title
  ]);
}

export function subscriptionIsCurrent(current, expected) {
  return Boolean(current?.enabled && expected?.enabled
    && subscriptionRevision(current) === subscriptionRevision(expected));
}

export function mergeSubscriptionCheckResults(subscriptions, updates) {
  const next = { ...(subscriptions ?? {}) };
  for (const [key, result] of Object.entries(updates)) {
    if (subscriptionIsCurrent(next[key], result.subscription)) {
      next[key] = { ...next[key], ...result.patch };
    }
  }
  return next;
}
