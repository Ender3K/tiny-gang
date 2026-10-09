export class TwitchError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}

export class TwitchApi {
  constructor(config, fetcher = fetch) { this.config = config; this.fetcher = fetcher; }
  authorizeUrl(state) {
    const url = new URL('https://id.twitch.tv/oauth2/authorize');
    url.search = new URLSearchParams({client_id: this.config.clientId, redirect_uri: this.config.redirectUri,
      response_type: 'code', scope: 'user:read:chat', state, force_verify: 'true'}).toString();
    return url.href;
  }
  async request(url, options = {}) {
    let response;
    try { response = await this.fetcher(url, {...options, signal: AbortSignal.timeout(15000)}); }
    catch { throw new TwitchError('Could not reach Twitch. Try connecting again.'); }
    if (!response.ok) throw new TwitchError(response.status === 401 ? 'Twitch authorization expired.' : `Twitch request failed (${response.status}).`, [400,401].includes(response.status) ? response.status : 502);
    return response.json();
  }
  async token(parameters) {
    const data = await this.request('https://id.twitch.tv/oauth2/token', {method: 'POST',
      headers: {'content-type': 'application/x-www-form-urlencoded'},
      body: new URLSearchParams({...parameters, client_id: this.config.clientId, client_secret: this.config.clientSecret})});
    if (!data.access_token || !data.refresh_token) throw new TwitchError('Twitch did not return a usable login.');
    return {accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: Date.now() + data.expires_in * 1000};
  }
  exchange(code) { return this.token({grant_type: 'authorization_code', code, redirect_uri: this.config.redirectUri}); }
  async refresh(record) {
    try { return await this.token({grant_type: 'refresh_token', refresh_token: record.refreshToken}); }
    catch (error) { if ([400,401].includes(error.status)) throw new TwitchError('Twitch authorization expired. Reconnect your channel.', 401); throw error; }
  }
  async validate(record) {
    const data = await this.request('https://id.twitch.tv/oauth2/validate', {headers: {Authorization: `OAuth ${record.accessToken}`}});
    if (data.client_id !== this.config.clientId || !data.scopes?.includes('user:read:chat') || (record.channelId && data.user_id !== record.channelId)) throw new TwitchError('Please reconnect Twitch with the channel owner account.', 401);
    return data;
  }
  async user(record) {
    const data = await this.request('https://api.twitch.tv/helix/users', {headers: this.headers(record)});
    const user = data.data?.[0];
    if (!user || !/^\d+$/.test(user.id) || !/^[a-z0-9_]{1,25}$/i.test(user.login)) throw new TwitchError('Could not identify your Twitch channel.');
    return user;
  }
  headers(record) { return {'Client-Id': this.config.clientId, Authorization: `Bearer ${record.accessToken}`}; }
  async subscribe(record, sessionId) {
    await this.request('https://api.twitch.tv/helix/eventsub/subscriptions', {method: 'POST',
      headers: {...this.headers(record), 'content-type': 'application/json'},
      body: JSON.stringify({type: 'channel.chat.message', version: '1',
        condition: {broadcaster_user_id: record.channelId, user_id: record.channelId},
        transport: {method: 'websocket', session_id: sessionId}})});
  }
}

export function validSocketUrl(value) {
  try { const url = new URL(value); return url.protocol === 'wss:' && url.hostname === 'eventsub.wss.twitch.tv' && !url.username && !url.password && (!url.port || url.port === '443'); }
  catch { return false; }
}

export class EventSubConnection {
  constructor({getRecord, subscribe, onChat, onStatus, onRevoked, WebSocketImpl = WebSocket,
    timers = {setTimeout, clearTimeout}, random = Math.random}) {
    Object.assign(this, {getRecord, subscribe, onChat, onStatus, onRevoked, WebSocketImpl, timers, random});
    this.sockets = new Set(); this.attempt = 0; this.stopped = false;
  }
  start() { this.open('wss://eventsub.wss.twitch.tv/ws', false); }
  report(status) { Promise.resolve(this.onStatus(status)).catch(() => {}); }
  open(url, migration) {
    if (this.stopped) return;
    if (!validSocketUrl(url)) { this.retry(); return; }
    let socket; try { socket = new this.WebSocketImpl(url); } catch { this.retry(); return; }
    this.sockets.add(socket); this.candidate = socket;
    if (!migration) this.report('connecting');
    let watchdog;
    socket.cleanup = () => this.timers.clearTimeout(watchdog);
    const arm = (seconds = 15) => {
      this.timers.clearTimeout(watchdog);
      watchdog = this.timers.setTimeout(() => { socket.close(); this.failed(socket); }, seconds * 1000);
    };
    arm();
    socket.addEventListener('message', event => {
      let data; try { data = JSON.parse(String(event.data)); } catch { return; }
      arm((socket.keepalive || 10) + 5);
      this.message(socket, data, migration).catch(error => {
        if (error.status === 401) { this.stop(); Promise.resolve(this.onRevoked()).catch(() => {}); }
        else { socket.close(); this.failed(socket); }
      });
    });
    socket.addEventListener('close', () => {
      this.timers.clearTimeout(watchdog); this.sockets.delete(socket); this.failed(socket);
    });
    socket.addEventListener('error', () => { socket.close(); });
  }
  async message(socket, data, migration) {
    if (this.stopped || !this.sockets.has(socket)) return;
    const type = data.metadata?.message_type;
    if (type === 'session_welcome') {
      if (socket !== this.candidate || !data.payload?.session?.id || socket.welcomed) return;
      socket.welcomed = true;
      socket.keepalive = Math.max(1, Number(data.payload.session.keepalive_timeout_seconds) || 10);
      // Twitch moves subscriptions itself on a requested session migration.
      if (!migration) await this.subscribe(data.payload.session.id);
      if (this.stopped || socket !== this.candidate || !this.sockets.has(socket)) return;
      const previous = this.active; this.active = socket;
      this.attempt = 0; this.report('connected');
      if (previous && previous !== socket) previous.close();
    } else if (type === 'session_reconnect' && socket === this.active) {
      this.open(data.payload?.session?.reconnect_url, true);
    } else if (type === 'revocation') {
      this.stop(); await this.onRevoked();
    } else if (type === 'notification' && socket === this.active) {
      const subscription = data.payload?.subscription;
      const event = data.payload?.event;
      if (subscription?.type !== 'channel.chat.message' || subscription.condition?.broadcaster_user_id !== this.getRecord().channelId || event?.broadcaster_user_id !== this.getRecord().channelId) return;
      this.onChat({messageId: data.metadata.message_id, sentAt: data.metadata.message_timestamp,
        userId: event.chatter_user_id, text: event.message?.text});
    }
  }
  failed(socket) {
    if (this.stopped) return;
    if (socket === this.active && this.candidate !== socket && this.sockets.has(this.candidate)) return;
    if (socket !== this.active && socket !== this.candidate) return;
    this.retry();
  }
  retry() {
    if (this.stopped || this.retryTimer || this.retrying) return;
    this.retrying = true;
    this.report('reconnecting');
    for (const socket of this.sockets) { socket.cleanup?.(); try { socket.close(); } catch {} }
    this.sockets.clear(); this.active = null; this.candidate = null;
    const delay = Math.min(30000, 1000 * 2 ** Math.min(this.attempt++, 5)) + Math.floor(this.random() * 500);
    this.retryTimer = this.timers.setTimeout(() => {this.retryTimer = null; this.start();}, delay);
    this.retrying = false;
  }
  stop() {
    this.stopped = true; this.timers.clearTimeout(this.retryTimer); this.retryTimer = null;
    for (const socket of this.sockets) { socket.cleanup?.(); try { socket.close(); } catch {} }
    this.sockets.clear();
  }
}
