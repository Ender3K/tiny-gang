# Spectator voting

The host can use **Copy spectator link** in the lobby or host controls during a game. It produces a link on the same GitHub Pages site, such as `https://ender3k.github.io/tiny-gang/?room=FIRE42&spectator=1`. If clipboard access fails, a dialog provides a selectable link.

The audience page does not display the room code. The spectator URL still contains the room identifier, so hiding the on-page code alone does not restrict participant access. Choose **Participant access → Invite only** when creating a lobby or in the host's lobby settings to require a separate private participant link. The host can copy that invite or display its QR code; invitees enter only their name. Anyone receiving or being forwarded the private link can join, subject to the existing late-join and kick controls. Switching back to game codes and then enabling invite only creates a new invite and invalidates the old one. Existing players retain their places.

The participant invite contains a random 256-bit token in its URL fragment. Its SHA-256 hash is public display metadata, not proof of membership. The token is stored at `roomInvites/CODE`, readable and writable only by the authenticated host. An invitee submits it at `joinProofs/CODE/FIREBASE_UID`, readable only by that identity. Firebase verifies the proof against the private token before permitting a new participant record. Other users cannot read either path. A custom client cannot join using only the public hash or room code. Successful joining removes the token from the address bar. Existing members survive invitation rotation, refreshes and rematches; old proofs cannot admit new members after rotation. Host refresh recovers the invitation from the private path.

Hosts can use **Hide join code** in the lobby or game controls while streaming. This local preference survives refreshes and rematches; it masks the lobby code and link dialogs and suppresses the join QR code while keeping private link copying available. Use **Show join code** to reveal it again.

Spectators open it directly without a name. They never register in `rooms/CODE/players`, subscribe to player votes, fetch the slide service, or load slide images. Viewers watch the stream and use the mobile page for the current slide number, shared countdown and Smash/Pass choices. Waiting rooms, missing rooms and disconnections disable voting. The page stays subscribed after the game ends and follows `nextRoomCode` into the host's rematch, updating the URL so refresh returns to the new room.

## Data and timing

Audience choices live only at `audienceVotes/CODE/SLIDE/FIREBASE_UID`, with a string value of `smash` or `pass`. Each leaf uses a Firebase transaction that creates a value only if it is null; `applyLocally: false` avoids displaying speculative acceptance. The accepted server snapshot/subscription restores the choice after a refresh or a concurrent submission from another tab. A rematch uses a new room code, so the same identity can vote again.

Audience votes appear as a proportional red Smash / blue Pass bar in the game sidebar, spectator page and both results breakdowns. Empty rounds show a neutral bar. Counts remain available to screen readers without displaying numbers. They never enter player votes, Smash points, Double Down, awards, comparisons, personal recaps or the existing CSV/statistics. Notes marked `!` and manual vetoes disable audience voting. If the host vetoes a slide after audience votes were accepted, those votes remain stored but are excluded from displayed tallies and marked unrated in the breakdown. Removing a manual veto restores the original accepted votes; it does not allow a second vote.

The host's `timer` is the authority: voting opens only at `status: running`, with a matching `slide` and an opened `rounds/SLIDE`. Even untimed rounds wait for the host's slide image to load. Enabled timers require a server deadline strictly greater than Firebase's `now`. As in existing player behavior, pausing freezes the countdown **and permits voting** while `remainingMs > 0`. A pause at zero does not reopen voting. Changing slides, ending the game or redirecting to a rematch rejects stale submissions at commit time. The spectator countdown uses the existing server clock offset; the rules enforce server time independently of a client's clock.

## Firebase setup before a live test

The JavaScript runs on GitHub Pages and uses the existing Realtime Database plus Firebase Anonymous Authentication. No login screen or new hosting service is needed. Follow [the security rollout instructions](SECURITY.md) to enable anonymous sign-in and deploy the app and rules together. Start fresh lobbies after rollout: old unauthenticated identities cannot safely be migrated into owners.

The rules enforce host ownership, own-player writes, membership, immutable own-UID votes, atomic once-per-game Double Down, and round/time eligibility. Neither host nor participants can edit/delete accepted player or audience votes through the client. Privileged console/Admin access is required for vote maintenance. Spectators still do not register as players. The slide service must support `notesRulesVersion: 1` to supply `!` flags; the lobby reports availability.
## Identity and capacity limits

Identity is now the Firebase Anonymous Authentication UID, persisted by Firebase in the browser. Copying `sop-device`, a participant ID, or the app's `sop-session` cannot impersonate another identity or gain host permissions. Same-origin tabs normally share the persisted Firebase session. Clearing Firebase storage, using a different browser/private profile, or creating another anonymous Firebase account creates a new identity. This is one vote per authenticated identity, not proof of one human per vote. Clearing the host's Firebase session also loses access to its old rooms. No names or personal information are requested from spectators. App Check and quotas can reduce automated abuse but do not replace ownership rules.

Firebase's Spark/free plan supports **100 simultaneous connections for the entire database**, including hosts, players, spectators, other rooms and each connected browser tab. Multiple listeners within one tab use the same Firebase connection. Leave headroom for players; a large streaming audience can exhaust this limit. [Firebase's connection limits](https://firebase.google.com/docs/database/usage/limits) list the cap. Audience subscribers receive a room's audience votes; bandwidth and stored votes grow with the audience and number of slides. A larger event needs a suitable Firebase plan/capacity and a privileged cleanup policy for old rooms.

## Fixture validation

Prerequisites: Node.js 20+ (22 recommended), pnpm, and Java 21+ for the database emulator. Install local test dependencies with `pnpm install --frozen-lockfile`, then `pnpm exec playwright install chromium`. On Linux, Playwright may also need OS libraries (`pnpm exec playwright install-deps chromium`). `CHROMIUM_PATH` can select a preinstalled browser. These are development tools, not runtime services or a production build step.

```sh
node --test tests/*.test.cjs
node tests/game-flow.browser.cjs
node tests/spectator-flow.browser.cjs
pnpm test:rules
```

The spectator browser test intercepts every Firebase, Google Slides and slide-service request with fixtures. It checks concurrent tabs, duplicate choices, accepted-vote restoration, preparation, pauses, expiry/advance/end races, vetoes, `!`, disconnection/reconnection, missing rooms, results, 320/390px layouts and rematch refresh. It asserts that spectator clients write only audience leaves, never register as players and never request Google Slides images or the slide service. The existing browser test verifies the original player gameplay, timer, Double Down, scores, QR links, exports and rematches.

The rules suite starts loopback Auth and Database emulators with a `demo-` project and refuses non-loopback endpoints. It uses actual anonymous Auth tokens, the real Firebase rules engine, and ETag races to test accepted operations and rejected host takeover, foreign writes, invitation bypass, duplicate votes, repeated Double Down and stale commits. Its second test drives the actual app and official Firebase SDK against those emulators, with only the slide service mocked. It checks silent sign-in, persisted identity, copied-session denial, host refresh, late joins, votes, spectators, invitation rotation, kicks and rematches. SDK assets are downloaded from Google's CDN; all Firebase data remains local and synthetic. Production Firebase is never contacted.
