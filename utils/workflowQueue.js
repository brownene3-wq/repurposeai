// utils/workflowQueue.js
//
// Bridges a "user just published from Splicora" event into the
// auto-workflow cross-publish engine. Called from every publish
// endpoint after a successful publishToConnection:
//
//   /repurpose/api/publish-output      (text posts from Library/Create)
//   /shorts/api/publish-moment         (Smart Shorts clip publishes)
//   /video-editor/api/publish-export   (Video Editor exports)
//
// For every active workflow whose source_account_id matches the
// connection just published to, we insert a content_queue row with
//   status:       'scheduled'
//   scheduled_at: now + workflow.delay_hours hours
//   metadata:     JSON payload the workflow engine needs to re-publish
//
// services/workflowEngine.js processScheduledQueue() picks those rows
// up on each cron tick once scheduled_at <= NOW() and runs them
// through publishToConnection again, this time targeting the
// destination account.

const { v4: uuidv4 } = require('uuid');

let workflowOps, contentQueueOps, pool;
try {
  const db = require('../db/database');
  workflowOps = db.workflowOps;
  contentQueueOps = db.contentQueueOps;
  pool = db.pool;
} catch (_) {}

// Generic enqueue. Best-effort — failures never block the originating
// publish response.
//
//   userId             - the publishing user
//   sourceConnectionId - id of the connected_accounts row we just
//                        published to. Workflows route on this.
//   payload            - what the downstream re-publish needs:
//                          title, description, text, mediaR2Key (opt),
//                          mediaFilename (opt), sourceUrl (opt),
//                          sourceType (e.g. 'clip' | 'post' | 'export')
//
// Returns the number of queue rows inserted, or 0 if nothing matched.
async function enqueueDownstreamPublishes(userId, sourceConnectionId, payload = {}) {
  if (!userId || !sourceConnectionId) return 0;
  if (!workflowOps || !contentQueueOps || !pool) return 0;
  try {
    // Pull active auto-publish workflows whose source is this connection.
    // workflowOps doesn't expose this exact filter so we inline-query.
    const res = await pool.query(
      `SELECT * FROM workflows
        WHERE user_id = $1
          AND source_account_id = $2
          AND auto_publish = true
          AND is_active = true`,
      [userId, sourceConnectionId]
    );
    const matched = res.rows || [];
    if (!matched.length) return 0;

    let queued = 0;
    for (const wf of matched) {
      // Compute scheduled_at based on the workflow's delay setting.
      //   delay_mode = 'immediate' → run on next cron tick (a couple
      //                              minutes max).
      //   delay_mode = 'custom'    → now + delay_hours.
      //   anything else            → now + delay_hours as a fallback.
      let delayMs = 0;
      const hours = Number(wf.delay_hours) || 0;
      if (wf.delay_mode === 'immediate') delayMs = 0;
      else delayMs = hours * 60 * 60 * 1000;
      const scheduledAt = new Date(Date.now() + delayMs);

      // Avoid double-queueing the same source publish for the same
      // workflow. We dedupe on the source content_queue.source_video_id
      // column, which we repurpose as "the unique id of the originating
      // publish event" — caller can pass payload.dedupeKey to force a
      // specific value; otherwise we fabricate one per call.
      const dedupeKey = String(payload.dedupeKey || ('ev-' + uuidv4().slice(0, 12)));
      try {
        const exists = await contentQueueOps.getByWorkflowAndSourceId(wf.id, dedupeKey);
        if (exists) continue;
      } catch (_) { /* table may be empty, fine */ }

      const entry = await contentQueueOps.create({
        workflowId: wf.id,
        userId,
        sourceVideoId: dedupeKey,
        sourceUrl: payload.sourceUrl || null,
        title: (payload.title || '').slice(0, 300),
        description: (payload.description || payload.text || '').slice(0, 5000),
        thumbnailUrl: payload.thumbnailUrl || null,
        duration: payload.durationSeconds || null,
        status: 'scheduled',
        scheduledAt,
        metadata: {
          sourceType: payload.sourceType || 'post',
          text: payload.text || payload.description || '',
          caption: payload.caption || payload.text || payload.description || '',
          mediaR2Key: payload.mediaR2Key || null,
          mediaFilename: payload.mediaFilename || null,
          mediaPath: payload.mediaPath || null,
          extras: payload.extras || null
        }
      });
      if (entry && entry.id) queued += 1;
      console.log(
        '[workflowQueue] queued workflow ' + wf.id +
        ' for user ' + userId +
        ' scheduled_at=' + scheduledAt.toISOString() +
        ' (delay=' + (delayMs / 1000 / 60).toFixed(1) + 'm)'
      );
    }
    return queued;
  } catch (err) {
    console.error('[workflowQueue] enqueue failed:', err.message);
    return 0;
  }
}

module.exports = { enqueueDownstreamPublishes };
