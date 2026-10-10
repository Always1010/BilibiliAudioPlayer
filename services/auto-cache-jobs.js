import { subscriptionIsCurrent, subscriptionRevision } from "./subscriptions.js";
import { normalizeMp3Bitrate } from "./mp3.js";

export function createAutoCacheJobs(subscriptionKey, subscription, tracks, settings, now = Date.now()) {
  const format = settings.defaultFormat === "mp3" ? "mp3" : "original";
  const bitrate = format === "mp3" ? normalizeMp3Bitrate(settings.mp3Bitrate) : null;
  const expectedSubscription = { creatorId: subscription.creatorId, section: subscription.section,
    enabled: true, mode: subscription.mode, revision: subscriptionRevision(subscription) };
  return tracks.map(track => {
    const key = JSON.stringify([subscriptionKey, subscriptionRevision(subscription), String(track.id), format, bitrate]);
    return { key, subscriptionKey, subscription: expectedSubscription, track, section: subscription.section,
      format, bitrate, status: "pending", attempts: 0, nextRetryAt: 0, createdAt: now };
  });
}

export function autoCacheJobIsCurrent(job, subscriptions) {
  return subscriptionIsCurrent(subscriptions?.[job.subscriptionKey], job.subscription)
    && subscriptions[job.subscriptionKey].mode === "download";
}

export function failedAutoCacheJob(job, message, now = Date.now()) {
  const attempts = (Number(job.attempts) || 0) + 1;
  const delay = Math.min(6 * 60 * 60 * 1000, 5 * 60 * 1000 * 2 ** Math.min(attempts - 1, 7));
  return { ...job, status: "failed", attempts, nextRetryAt: now + delay,
    lastError: message || "自动缓存失败", updatedAt: now };
}

export function cacheOutcomeKeys(cache) {
  return [...new Set(cache?.autoCacheKeys ?? cache?.activity?.autoCacheKeys ?? [])];
}
