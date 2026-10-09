export class FirebaseStore {
  constructor(db) { this.db = db; }
  async getRoom(code) { return (await this.db.ref(`rooms/${code}`).get()).val(); }
  watchRoom(code, callback, onError) {
    const reference = this.db.ref(`rooms/${code}`), listener = snapshot => callback(snapshot.val());
    reference.on('value', listener, onError);
    return () => reference.off('value', listener);
  }
  async getConnection(code) { return (await this.db.ref(`twitch/${code}/connection`).get()).val(); }
  async setConnection(code, data) { await this.db.ref(`twitch/${code}/connection`).set(data); }
  async status(code, connectionId, status) {
    await this.db.ref(`twitch/${code}/connection`).transaction(current => {
      if (!current || current.id !== connectionId) return;
      return {...current, status, updatedAt: Date.now()};
    });
  }
  async recordVotes(code, slide, openedAt, votes) {
    const reference = this.db.ref(`twitchPrivate/${code}/${slide}`);
    const result = await reference.transaction(current => {
      if (current && current.openedAt !== openedAt) return;
      const data = current || {openedAt, voters: {}, smash: 0, pass: 0, total: 0};
      data.voters ||= {};
      for (const [id, choice] of Object.entries(votes)) {
        if (data.voters[id] || !/^\d{1,30}$/.test(id) || !['smash','pass'].includes(choice)) continue;
        data.voters[id] = choice; data[choice]++; data.total++;
      }
      return data;
    });
    if (!result.committed) return;
    const {smash, pass, total} = result.snapshot.val();
    // Concurrent publishes cannot move a tally backwards. Viewer IDs stay private.
    await this.db.ref(`twitch/${code}/rounds/${slide}`).transaction(current => {
      if (current && (current.openedAt !== openedAt || current.total > total)) return;
      return {openedAt, smash, pass, total};
    });
  }
  async recoverVotes(code) {
    const data = (await this.db.ref(`twitchPrivate/${code}`).get()).val() || {};
    for (const [slide, round] of Object.entries(data)) {
      if (round) await this.recordVotes(code, Number(slide), round.openedAt, {});
    }
  }
}
