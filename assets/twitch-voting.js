(function () {
  const read = key => {try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }};
  const write = (key, value) => {try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Private browsing can disable storage. */ }};
  const random = size => Array.from(crypto.getRandomValues(new Uint8Array(size)), n => n.toString(16).padStart(2, '0')).join('');
  async function ownerKey() {
    const key = random(32), digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
    return {key, hash:Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('')};
  }
  class TwitchVoting {
    constructor({onValue, reference}) {
      Object.assign(this, {onValue, reference});
      this.data = {}; this.code = ''; this.room = null;
      this.dialog = document.createElement('dialog'); this.dialog.className = 'twitch-dialog';
      this.dialog.innerHTML = `<form method="dialog"><button class="dialog-close" aria-label="Close Twitch settings">×</button></form><h2>Twitch chat voting</h2><p>Connect your own channel. Viewers vote with !smash or !pass. Their tally stays separate from lobby players.</p><label for="twitchServiceUrl">Twitch service URL</label><input id="twitchServiceUrl" type="url" placeholder="https://your-service.onrender.com"><p class="hint">Use the URL of your deployed Twitch service. Allow at least 30 seconds per slide for stream delay. Viewers can include a slide number, e.g. !smash 3.</p><p id="twitchSetupStatus" role="status"></p><div class="twitch-actions"><button id="twitchConnect" class="btn btn-fire" type="button">Connect Twitch</button><button id="twitchDisconnect" class="btn btn-ghost" type="button">Disconnect</button></div>`;
      document.body.append(this.dialog);
      this.input = this.dialog.querySelector('input'); this.note = this.dialog.querySelector('#twitchSetupStatus');
      this.dialog.querySelector('#twitchConnect').onclick = () => this.connect();
      this.dialog.querySelector('#twitchDisconnect').onclick = () => this.disconnect();
      this.dialog.addEventListener('close', () => this.cancelPopup());
      this.panels = ['twitchWaiting','twitchGame','twitchResults'].map(id => document.getElementById(id));
      window.addEventListener('message', event => this.message(event));
    }
    static async reserve() { return ownerKey(); }
    static remember(code, key) { write('sop-twitch-owner-'+code, key); }
    stop() {
      this.unsubscribe?.(); this.unsubscribe = null; this.code = ''; this.room = null; this.data = {};
      this.cancelPopup(); this.dialog.close(); this.render();
    }
    update(room, me) {
      this.room = room; this.me = me;
      if (this.code !== me.code) {
        this.cancelPopup(); this.unsubscribe?.(); this.data = {}; this.code = me.code;
        this.unsubscribe = this.onValue(this.reference('twitch/'+me.code), snapshot => {this.data = snapshot.val() || {}; this.render();}, () => {this.note.textContent = 'Could not read the chat tally. Check the database rules.';});
      }
      this.render();
    }
    render() {
      const connection = this.data.connection, room = this.room;
      for (const [index, panel] of this.panels.entries()) {
        if (!panel) continue;
        panel.replaceChildren();
        panel.hidden = !room || (!connection && !this.me?.isMaster) || (index === 2 && !connection);
        if (panel.hidden) continue;
        const title = document.createElement('div'); title.className = 'panel-title'; title.textContent = 'Twitch chat'; panel.append(title);
        if (connection) {
          const channel = document.createElement('a'); channel.textContent = '@'+connection.channel;
          if (/^[a-z0-9_]{1,25}$/i.test(connection.channel)) channel.href = 'https://www.twitch.tv/'+connection.channel;
          channel.target = '_blank'; channel.rel = 'noopener noreferrer'; panel.append(channel);
          const status = document.createElement('p'); status.className = 'hint'; status.dataset.twitchStatus = '';
          const labels = {connecting:'Connecting to chat…',connected:'Chat connected',reconnecting:'Reconnecting to chat…',authorization_required:'Host needs to reconnect Twitch',disconnected:'Chat disconnected',ended:'Chat voting ended',storage_error:'Chat tally unavailable — check the service'};
          status.textContent = labels[connection.status] || 'Chat connection unavailable'; panel.append(status);
          if (index === 1) {
            const slide = room.currentSlide, tally = this.data.rounds?.[slide] || {};
            const unrated = room.slideVotingDisabled?.[slide] === true || room.vetoed?.[slide] === true;
            const closed = room.state !== 'playing' || room.timer?.status !== 'running' || (room.timer.enabled && !room.timer.paused && room.timer.dueAt && Date.now() >= room.timer.dueAt);
            const instructions = document.createElement('p'); instructions.className = 'hint'; instructions.dataset.twitchInstructions = '';
            instructions.textContent = unrated ? 'Voting disabled on this slide' : closed ? 'Chat voting is closed while the slide prepares or the timer has ended.' : `Slide ${slide}: !smash or !pass · one vote per account`;
            const counts = document.createElement('p'); counts.className = 'twitch-tally'; counts.dataset.twitchTally = '';
            counts.textContent = `🔥 ${tally.smash || 0} smash · ❄️ ${tally.pass || 0} pass · ${tally.total || 0} vote${tally.total === 1 ? '' : 's'}`;
            panel.append(instructions, counts);
          }
          if (index === 2) {
            const rounds = Object.entries(this.data.rounds || {}).filter(([slide]) => room.rounds?.[slide] && !room.slideVotingDisabled?.[slide] && !room.vetoed?.[slide]);
            const sum = rounds.reduce((result, [,value]) => ({smash:result.smash+(value.smash || 0),pass:result.pass+(value.pass || 0)}),{smash:0,pass:0});
            const totals = document.createElement('p'); totals.textContent = `${sum.smash+sum.pass} chat votes across rated slides · ${sum.smash} smash · ${sum.pass} pass`; panel.append(totals);
            if (rounds.length) {
              const details = document.createElement('details'), summary = document.createElement('summary'); summary.textContent = 'Chat votes by slide'; details.append(summary);
              for (const [slide,tally] of rounds.sort((a,b)=>Number(a[0])-Number(b[0]))) {const row = document.createElement('p'); row.textContent = `Slide ${slide}: ${tally.smash || 0} smash · ${tally.pass || 0} pass`; details.append(row);}
              panel.append(details);
            }
          }
        } else {const hint = document.createElement('p'); hint.className = 'hint'; hint.textContent = 'Let your Twitch viewers vote alongside the lobby.'; panel.append(hint);}
        if (this.me?.isMaster && index !== 2) {const button = document.createElement('button'); button.className = 'restart-btn'; button.textContent = connection ? 'Twitch settings' : 'Set up Twitch'; button.onclick = () => this.open(); panel.append(button);}
      }
    }
    open() {
      this.input.value = read('sop-twitch-service') || window.TWITCH_SERVICE_URL || '';
      this.note.textContent = ''; this.dialog.showModal();
    }
    service() {
      const url = new URL(this.input.value.trim());
      if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1'].includes(url.hostname)))) throw new Error('Enter the service origin, such as https://your-service.onrender.com.');
      write('sop-twitch-service', url.origin); return url.origin;
    }
    async request(origin, path, data) {
      let response;
      try {response = await fetch(origin+path, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),signal:AbortSignal.timeout(20000)});} catch {throw new Error('Could not reach the Twitch service. Check its URL and APP_ORIGINS setting.');}
      let result; try {result = await response.json();} catch {throw new Error('This URL did not return a Twitch service response.');}
      if (!response.ok) throw new Error(result.error || 'The Twitch service rejected this request.');
      return result;
    }
    async connect() {
      this.cancelPopup();
      try {
        const origin = this.service(), hostKey = read('sop-twitch-owner-'+this.code);
        if (!hostKey) throw new Error('Create a fresh lobby on this device to connect Twitch.');
        const popup = window.open('about:blank','tiny-gang-twitch','width=540,height=720');
        if (!popup) throw new Error('Allow popups for this page, then try again.');
        const pending = {popup,origin,code:this.code,attemptId:random(16)}; this.pending = pending;
        this.note.textContent = 'Opening Twitch login…';
        this.dialog.querySelector('#twitchConnect').disabled = true;
        const result = await this.request(origin, '/api/connect/begin', {roomCode:this.code,hostKey,attemptId:pending.attemptId});
        if (this.pending !== pending) return;
        const url = new URL(result.authorizationUrl);
        if (url.origin !== 'https://id.twitch.tv' || url.pathname !== '/oauth2/authorize') throw new Error('The service returned an invalid Twitch login URL.');
        popup.location.href = url.href;
        this.poll = setInterval(() => {if (popup.closed) {this.cancelPopup(); this.note.textContent = 'Login window closed. Connect again if your channel is not connected.';}},1000);
        this.expiry = setTimeout(() => {this.cancelPopup(); this.note.textContent = 'Login expired. Connect again.';},600000);
      } catch (error) {this.cancelPopup(); this.note.textContent = error.message;}
    }
    message(event) {
      const pending = this.pending, data = event.data;
      if (!pending || event.origin !== pending.origin || event.source !== pending.popup || data?.type !== 'tiny-gang-twitch' || data.roomCode !== pending.code || data.attemptId !== pending.attemptId) return;
      if (data.ok && /^[a-f0-9]{64}$/.test(data.controlToken || '')) {
        write('sop-twitch-control-'+pending.origin+'-'+pending.code, data.controlToken);
        this.note.textContent = 'Connected to @'+data.channel+'. Chat votes will appear separately.';
      } else this.note.textContent = data.error || 'Could not connect Twitch. Try again.';
      this.cancelPopup();
    }
    cancelPopup() {
      clearInterval(this.poll); clearTimeout(this.expiry); this.pending?.popup.close(); this.pending = null;
      this.dialog.querySelector('#twitchConnect').disabled = false;
    }
    async disconnect() {
      try {
        const origin = this.service(), controlToken = read('sop-twitch-control-'+origin+'-'+this.code);
        if (!controlToken) throw new Error('Connect Twitch on this device first.');
        await this.request(origin,'/api/disconnect',{roomCode:this.code,controlToken}); this.note.textContent = 'Twitch disconnected.';
      } catch (error) {this.note.textContent = error.message;}
    }
  }
  window.TwitchVoting = TwitchVoting;
})();
