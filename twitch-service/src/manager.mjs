import {createHash, randomBytes, timingSafeEqual} from 'node:crypto';
import {EventSubConnection, TwitchError} from './twitch.mjs';
import {VoteCollector} from './votes.mjs';

export const secret = () => randomBytes(32).toString('hex');
export const hash = value => createHash('sha256').update(String(value)).digest('hex');
export function matches(value, expected) {
  const actual = hash(value);
  return typeof expected === 'string' && expected.length === actual.length && timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}
export class ConnectionManager {
  constructor({store, vault, api, socketFactory = options => new EventSubConnection(options)}) {
    Object.assign(this, {store, vault, api, socketFactory});
    this.active = new Map(); this.chain = Promise.resolve(); this.refreshing = new Map();
  }
  serial(fn) { const operation = this.chain.catch(() => {}).then(fn); this.chain = operation; return operation; }
  async verifyOwner(code, proof) {
    if (!/^[A-Z0-9]{4,10}$/.test(code || '') || !/^[a-f0-9]{64}$/.test(proof || '')) throw new TwitchError('Invalid room connection request.', 400);
    const room = await this.store.getRoom(code);
    if (!room || !['waiting','playing'].includes(room.state) || !matches(proof, room.twitchControlHash)) throw new TwitchError('Create a fresh lobby on this device to connect Twitch.', 403);
    return room;
  }
  async token(record, force = false) {
    if (!force && record.expiresAt > Date.now() + 60000) return record;
    if (!this.refreshing.has(record.code)) {
      const operation = (async () => {
        Object.assign(record, await this.api.refresh(record));
        if (this.vault.get(record.code) === record) await this.vault.set(record.code, record);
        return record;
      })();
      this.refreshing.set(record.code, operation);
      operation.finally(() => this.refreshing.delete(record.code)).catch(() => {});
    }
    return this.refreshing.get(record.code);
  }
  async withToken(record, fn) {
    try { return await fn(await this.token(record)); }
    catch (error) { if (error.status !== 401) throw error; return fn(await this.token(record, true)); }
  }
  connect(code, ownerHash, tokens, user) {
    return this.serial(async () => {
      const room = await this.store.getRoom(code);
      if (!room || room.twitchControlHash !== ownerHash || !['waiting','playing'].includes(room.state)) throw new TwitchError('This lobby has ended. Create a new lobby.', 409);
      for (const previous of this.vault.list()) {
        if (previous.code === code || previous.channelId === user.id) await this.detach(previous.code, 'disconnected');
      }
      const controlToken = secret();
      const record = {...tokens, code, ownerHash, channelId:user.id, channel:user.login, connectionId:secret(), controlHash:hash(controlToken)};
      await this.vault.set(code, record);
      try { await this.attach(record); } catch (error) { await this.detach(code,'disconnected'); throw error; }
      return {controlToken, channel:user.login};
    });
  }
  async attach(record) {
    let room = await this.store.getRoom(record.code);
    if (!room || room.twitchControlHash !== record.ownerHash || !['waiting','playing'].includes(room.state)) {
      await this.detach(record.code, 'ended'); return;
    }
    await this.withToken(record, value => this.api.validate(value));
    await this.store.recoverVotes(record.code);
    await this.store.setConnection(record.code, {id:record.connectionId, channel:record.channel, status:'connecting', updatedAt:Date.now()});
    const status = value => this.store.status(record.code, record.connectionId, value);
    const collector = new VoteCollector({store:this.store, roomCode:record.code, getRoom:() => room,
      onError:() => status('storage_error').catch(() => {})});
    const socket = this.socketFactory({getRecord:() => record,
      subscribe:id => this.withToken(record, value => this.api.subscribe(value, id)),
      onChat:message => collector.receive(message), onStatus:status,
      onRevoked:() => this.serial(() => this.detach(record.code, 'authorization_required'))});
    const entry = {socket, collector, stopWatch:() => {}, validation:null};
    this.active.set(record.code, entry);
    entry.stopWatch = this.store.watchRoom(record.code, value => {
      room = value;
      if (!value || value.twitchControlHash !== record.ownerHash || !['waiting','playing'].includes(value.state)) {
        collector.stopped = true;
        this.serial(() => this.detach(record.code, 'ended')).catch(() => {});
      }
    }, () => { room = null; status('storage_error').catch(() => {}); });
    entry.validation = setInterval(() => {
      this.withToken(record, value => this.api.validate(value)).catch(error => {
        if (error.status === 401) this.serial(() => this.detach(record.code, 'authorization_required')).catch(() => {});
      });
    }, 60 * 60 * 1000);
    entry.validation.unref?.();
    socket.start();
  }
  async detach(code, status) {
    const record = this.vault.get(code), entry = this.active.get(code);
    this.active.delete(code);
    if (entry) {
      entry.socket.stop(); entry.stopWatch(); clearInterval(entry.validation);
      try { await entry.collector.stop(); } catch { /* Report the storage issue without exposing credentials. */ status = 'storage_error'; }
    }
    if (record) { await this.store.status(code, record.connectionId, status); await this.vault.delete(code); }
  }
  disconnect(code, controlToken) {
    return this.serial(async () => {
      const record = this.vault.get(code);
      if (!record || !matches(controlToken, record.controlHash)) throw new TwitchError('Reconnect Twitch from the host device before disconnecting.', 403);
      await this.detach(code, 'disconnected');
    });
  }
  async restore() {
    for (const record of this.vault.list()) {
      try { await this.attach(record); }
      catch (error) {
        if (error.status === 401) await this.detach(record.code, 'authorization_required');
        else throw new Error('Could not restore Twitch connections. Check service connectivity and restart.');
      }
    }
  }
  async close() {
    await this.chain.catch(() => {});
    for (const entry of this.active.values()) {
      entry.socket.stop(); entry.stopWatch(); clearInterval(entry.validation);
      await entry.collector.stop().catch(() => {});
    }
    this.active.clear();
    // Keep encrypted authorizations for a normal service restart.
  }
}
