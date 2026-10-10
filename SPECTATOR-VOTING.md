# Spectator voting

The host can use **Copy spectator link** in the lobby or host controls during a game. It produces a link on the same GitHub Pages site, such as `https://ender3k.github.io/tiny-gang/?room=FIRE42&spectator=1`. If clipboard access fails, a dialog provides a selectable link.

The audience page does not display the room code. The spectator URL still contains the room identifier, so hiding the on-page code alone does not restrict participant access. Choose **Participant access → Invite only** when creating a lobby or in the host's lobby settings to require a separate private participant link. The host can copy that invite or display its QR code; invitees enter only their name. Anyone receiving or being forwarded the private link can join, subject to the existing late-join and kick controls. Switching back to game codes and then enabling invite only creates a new invite and invalidates the old one. Existing players retain their places.

The participant invite contains a random 256-bit token in its URL fragment. Only its SHA-256 hash is stored in public room data; the token remains in the host's saved local session. Spectator links never include this token, and a spectator link or room code alone is rejected by the participant join flow for invite-only rooms. Successful joining removes the token from the address bar. Refreshes restore existing membership, and rematches carry over invite-only access and the current invite token with the group. Invite-only checks run inside the app's room transaction, including retries; the existing unauthenticated Firebase room permissions still allow a custom client to bypass them. This is an app-level joining restriction, not authenticated database access control. Enforcing private membership against direct database writes requires authenticated host/player permissions and corresponding server rules.

Hosts can use **Hide join code** in the lobby or game controls while streaming. This local preference survives refreshes and rematches; it masks the lobby code and link dialogs and suppresses the join QR code while keeping private link copying available. Use **Show join code** to reveal it again.

Spectators open it directly without a name. They never register in `rooms/CODE/players`, subscribe to player votes, fetch the slide service, or load slide images. Viewers watch the stream and use the mobile page for the current slide number, shared countdown and Smash/Pass choices. Waiting rooms, missing rooms and disconnections disable voting. The page stays subscribed after the game ends and follows `nextRoomCode` into the host's rematch, updating the URL so refresh returns to the new room.

## Data and timing

Audience choices live only at `audienceVotes/CODE/SLIDE/BROWSER_ID`, with a string value of `smash` or `pass`. Each leaf uses a Firebase transaction that creates a value only if it is null; `applyLocally: false` avoids displaying speculative acceptance. The accepted server snapshot/subscription restores the choice after a refresh or a concurrent submission from another tab. A rematch uses a new room code, so the same identity can vote again.

Audience votes appear as a proportional red Smash / blue Pass bar in the game sidebar, spectator page and both results breakdowns. Empty rounds show a neutral bar. Counts remain available to screen readers without displaying numbers. They never enter player votes, Smash points, Double Down, awards, comparisons, personal recaps or the existing CSV/statistics. Notes marked `!` and manual vetoes disable audience voting. If the host vetoes a slide after audience votes were accepted, those votes remain stored but are excluded from displayed tallies and marked unrated in the breakdown. Removing a manual veto restores the original accepted votes; it does not allow a second vote.

The host's `timer` is the authority: voting opens only at `status: running`, with a matching `slide` and an opened `rounds/SLIDE`. Even untimed rounds wait for the host's slide image to load. Enabled timers require a server deadline strictly greater than Firebase's `now`. As in existing player behavior, pausing freezes the countdown **and permits voting** while `remainingMs > 0`. A pause at zero does not reopen voting. Changing slides, ending the game or redirecting to a rematch rejects stale submissions at commit time. The spectator countdown uses the existing server clock offset; the rules enforce server time independently of a client's clock.

## Firebase setup before a live test

No separate hosting, Functions, Twitch credentials or new Firebase service is required. The JavaScript runs on GitHub Pages and connects to the existing Realtime Database.

1. Save a copy of the current Realtime Database rules in the Firebase console. This repository previously contained no deployed rules snapshot; the provided file is a compatibility ruleset for the app's existing unauthenticated access, not a claim about the current production rules.
2. Review and publish [`firebase/database.rules.json`](firebase/database.rules.json) in **Realtime Database → Rules** on the existing database. If the database also serves unrelated applications, preserve their path-specific access. The supplied rules allow the existing app's room-level reads/writes and transactions, `votes` writes (including root multi-path updates), and `ddused` reads/writes. They add room-level audience reads and strictly first-write-only audience leaf writes. No root database read or write is needed by the app.
3. Remove any broader `.write: true` grants at the root or any ancestor of `audienceVotes`. Firebase grants cascade; a permissive ancestor would bypass the first-vote/eligibility rule. Do not simply add restrictive leaf rules below an existing root write grant. [Firebase rule conditions](https://firebase.google.com/docs/database/security/rules-conditions) explain this behavior.
4. Serve the branch build from GitHub Pages or a local static server for review. The requested branch is not merged into `main`, so a Pages site configured to publish `main` will not yet contain this implementation. The existing slide service must already support `notesRulesVersion: 1` to supply `!` flags; the existing app reports this in the lobby.
5. For an authorized live test, create a new disposable room and open the host's spectator link on another browser. Verify the audience tally and refresh recovery before inviting viewers. All automated tests described below use fixtures and do not touch live rooms. The production rules were not changed by this implementation.

The rules enforce immutability and eligibility against the database's current room state. **Existing room/player access remains unauthenticated and writable**, as required for compatibility. They do not establish an authenticated host role or prevent a malicious client from editing room state or choosing another browser ID. Hardening host/player permissions would require a separate authentication migration. Deleting audience data for maintenance requires privileged console/Admin access because clients cannot overwrite or delete accepted votes.

## Identity and capacity limits

The browser identity is the app's random `sop-device` ID stored in localStorage. Tabs on the same origin/profile share it. Other browsers, devices, private profiles, clearing site data, or manually changing localStorage produce a new identity and can cast another vote. If persistent storage is unavailable, refresh cannot retain the identity. This is a **per-browser convenience restriction, not one verified human per vote**. No names or personal information are requested from spectators.

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

The rules test starts a loopback database emulator with a `demo-` project. It rejects any non-loopback endpoint and uses only synthetic data. It exercises the actual Firebase rules engine and ETag compare-and-set races, plus compatibility with room/player/root multi-path access. No credentials or live database endpoints are used. Screenshots are written to `/tmp/tiny-gang-spectator-mobile.png` and the existing player screenshot paths.
