export function parseVote(text) {
  const match = /^!(smash|pass)(?:\s+([1-9]\d{0,5}))?$/i.exec(String(text || '').trim());
  return match ? {choice: match[1].toLowerCase(), slide: match[2] ? Number(match[2]) : null} : null;
}

export function eligibleChatVote(room, message, now = Date.now()) {
  const vote = parseVote(message.text);
  const slide = room?.currentSlide;
  const openedAt = room?.rounds?.[slide]?.openedAt;
  const sentAt = Date.parse(message.sentAt);
  if (!vote || !/^\d{1,30}$/.test(message.userId || '') || room?.state !== 'playing') return null;
  if (!Number.isSafeInteger(slide) || !Number.isFinite(openedAt) || !Number.isFinite(sentAt)) return null;
  if (room.slideVotingDisabled?.[slide] === true || room.vetoed?.[slide] === true) return null;
  if (room.timer?.status !== 'running' || sentAt < openedAt || sentAt > now + 5000) return null;
  if (vote.slide !== null && vote.slide !== slide) return null;
  if (room.timer.enabled && !room.timer.paused && room.timer.dueAt && (now >= room.timer.dueAt || sentAt >= room.timer.dueAt)) return null;
  return {slide, openedAt, userId: message.userId, choice: vote.choice};
}

// Commit small batches so a busy chat does not rewrite the whole ballot for every message.
// Firebase still performs the final per-account deduplication across reconnects/restarts.
export class VoteCollector {
  constructor({store, roomCode, getRoom, now = Date.now, delay = 250, onError = () => {}}) {
    Object.assign(this, {store, roomCode, getRoom, now, delay, onError});
    this.pending = new Map();
    this.seen = new Map();
    this.stopped = false;
    this.chain = Promise.resolve();
  }
  receive(message) {
    if (this.stopped) return false;
    const room = this.getRoom();
    const vote = eligibleChatVote(room, message, this.now());
    if (!vote) return false;
    if (message.messageId && this.seen.has(message.messageId)) return false;
    if (message.messageId) this.seen.set(message.messageId, this.now());
    while (this.seen.size > 10000) this.seen.delete(this.seen.keys().next().value);
    const key = `${vote.slide}:${vote.openedAt}`;
    if (!this.pending.has(key)) this.pending.set(key, {slide: vote.slide, openedAt: vote.openedAt, votes: new Map()});
    const batch = this.pending.get(key);
    if (!batch.votes.has(vote.userId)) batch.votes.set(vote.userId, vote.choice);
    if (!this.timer) this.timer = setTimeout(() => {this.timer = null; this.flush().catch(this.onError);}, this.delay);
    return true;
  }
  flush() {
    clearTimeout(this.timer); this.timer = null;
    const batches = [...this.pending.values()]; this.pending.clear();
    this.chain = this.chain.catch(() => {}).then(async () => {
      for (const batch of batches) {
        let lastError;
        for (let attempt = 0; attempt < 3; attempt++) {
          try { await this.store.recordVotes(this.roomCode, batch.slide, batch.openedAt, Object.fromEntries(batch.votes)); lastError = null; break; }
          catch (error) { lastError = error; if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1))); }
        }
        if (lastError) throw lastError;
      }
    });
    return this.chain;
  }
  async stop() { this.stopped = true; await this.flush(); }
}
