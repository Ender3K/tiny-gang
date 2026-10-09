# Twitch chat voting

Hosts connect their own Twitch channel from the lobby or host controls. Viewers type `!smash` or `!pass`, and their first accepted vote wins for that slide. Chat has its own tally on the game screen and a slide breakdown on results. Lobby points, Double Down and player awards keep their existing meaning.

Voting opens when the host's slide is ready. It closes at the shared timer deadline or when the host changes slides or ends the game. Slides marked `!` in speaker notes and manually vetoed slides refuse chat votes. A paused timer permits votes, matching lobby voting. Explicit commands such as `!pass 3` bind a vote to slide 3 and help with stream delay. Timestamp checks reject messages sent before a new round opened, but cannot identify an unnumbered vote sent after a transition while someone is watching delayed video. Give viewers at least 30 seconds and display the current slide number on stream.

## Set up the service

The integration is on `feat/twitch-chat-voting`. No Twitch application, Render service, billing plan or live Firebase rules have been created by this change. The GitHub Pages site on `main` keeps its current version until this branch is merged.

1. Open the [Twitch Developer Console](https://dev.twitch.tv/console/apps) and register an application. Twitch requires two-factor authentication. Select a confidential client if the form asks. Save the client ID; generate a client secret and keep it in secure server settings. If the registration form requires a redirect URL before your service exists, use `http://localhost:8787/auth/twitch/callback` initially and add the public service callback in step 5.
2. Choose a service host. The repository's [Render blueprint](../render.yaml) deploys the feature branch as one Node 24 service with a persistent disk. **The starter service and disk cost money; review Render's prices before creating it.** Create it in [Render](https://dashboard.render.com/) using the blueprint, or use the same build/start commands and environment variables on another host. Keep one service instance: connections and the encrypted vault belong to that instance.
3. In Firebase Console, select project `smash-or-pass-bb76b`, open **Project settings → Service accounts**, and generate a private key for the server. Set `FIREBASE_SERVICE_ACCOUNT_JSON` to the complete JSON object in secure service environment settings. Never put this file in GitHub or the browser. For a different Firebase project, also update the static app's Firebase configuration and `FIREBASE_DATABASE_URL`.
4. Set `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET` and `FIREBASE_SERVICE_ACCOUNT_JSON` in the service. Render generates `TOKEN_ENCRYPTION_KEY`; keep that key stable across deploys. The disk path is `/var/data/twitch-tokens.json`. The service uses Render's `RENDER_EXTERNAL_URL` automatically. On another host set `PUBLIC_URL` to its HTTPS origin (no path). `APP_ORIGINS` lists exact permitted game origins, comma separated; the default is `https://ender3k.github.io`. Include the origin of your branch preview to test before merging.
5. Once the service URL is known, add **`https://YOUR-SERVICE/auth/twitch/callback`** as the exact OAuth redirect URL in the Twitch application. Deploy/restart with the completed settings. A request to `/health` should return `{"ok":true}`.
6. In Firebase **Realtime Database → Rules**, back up the existing rules and apply [firebase.rules.json](firebase.rules.json). These rules keep room/vote access used by this anonymous lobby app, freeze each room's Twitch ownership proof and host ID, give browsers read-only chat aggregates, and hide per-account chat ballots. A permissive root `.write: true` would override the protected paths; it must be removed. Room deletion by browser clients is disallowed so another client cannot recreate a room with a different ownership proof. Administrative cleanup can use Firebase Console. These rules preserve the app's existing anonymous trust model for room controls; they do not add player authentication.
7. Serve this branch's static app from an allowed origin. For a public preview without changing GitHub Pages, create a Render Static Site from the same repository and feature branch, with build command `echo static` and publish directory `.`; add that preview origin to the Node service's `APP_ORIGINS` and redeploy it. Create a **fresh lobby**, choose **Set up Twitch**, enter the service URL, and sign in as the channel owner. To prefill the URL for hosts later, set the public `window.TWITCH_SERVICE_URL` in [assets/twitch-config.js](../assets/twitch-config.js). Hosts can override it in settings. Each channel connects to one room at a time; connecting it to another room moves the connection.

Disconnect works from the host device that completed login. A normal service restart restores active connections from encrypted storage and preserves account deduplication in Firebase. Game completion closes the chat connection and removes its stored authorization; each rematch requires connecting the channel to the new lobby. Public results remain readable. If a host loses browser storage, they can create a new lobby and reconnect. If Twitch revokes authorization, reconnect from the host controls.

## Local development and checks

Use Node 22 or newer (tested with Node 24), Python 3 and Playwright/Chromium for browser checks. From the repository root:

```sh
npm --prefix twitch-service ci --ignore-scripts
node --test tests/*.test.cjs
npm --prefix twitch-service test
node tests/game-flow.browser.cjs
node tests/twitch-flow.browser.cjs
python3 -m http.server 8000 --bind 127.0.0.1
```

Both browser checks use mocked Firebase and slide data. The Twitch check runs the real local HTTP/OAuth service with simulated Twitch responses and EventSub messages. They create no live rooms and need no credentials. Set `CHROMIUM_PATH` if Chromium is elsewhere; install Playwright in your development environment if absent. There is no static build step.

For live local service testing, copy `.env.example` to `.env` inside `twitch-service`, fill it locally (use a single-line JSON value for the service account), register `http://localhost:8787/auth/twitch/callback` in Twitch, then run:

```sh
cd twitch-service
node --env-file=.env src/server.mjs
```

Keep the game origin and `APP_ORIGINS` consistent (`localhost` and `127.0.0.1` are different origins). The backend needs outbound HTTPS to `id.twitch.tv`, `api.twitch.tv`, Google's OAuth endpoint and the configured Firebase database, plus WebSocket access to `eventsub.wss.twitch.tv`.

## Operational notes

Twitch tokens are encrypted on the service disk with AES-256-GCM. They are validated at login, restoration and hourly; refresh operations are coalesced. EventSub session migration preserves subscriptions, unexpected disconnects retry with backoff, and stopped connections clear watchdogs. Requests and callbacks never log tokens or chat text. Do not enable a reverse proxy access log that records the OAuth callback's query string.

The service accepts only exact allowed origins, binds OAuth state to a room ownership proof, expires it after ten minutes and consumes it once. Browser control tokens are separate from Twitch tokens. Account IDs used for deduplication stay under `twitchPrivate`; public `twitch` data contains only the channel, status and aggregate counts. Firebase keeps these round records until an administrator removes old room data. Votes are batched every 250 ms, with three attempts on storage failure. A persistent database outage can lose an uncommitted batch and displays `Chat tally unavailable`; this is not an exactly-once guarantee during outages. During a network partition the service may briefly use the last observed room state, so it should not be treated as a competition-grade voting system.

References: [Twitch OAuth authorization code flow](https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/#authorization-code-grant-flow), [EventSub WebSockets](https://dev.twitch.tv/docs/eventsub/handling-websocket-events/), [channel.chat.message](https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/#channelchatmessage), [token validation](https://dev.twitch.tv/docs/authentication/validate-tokens/).
