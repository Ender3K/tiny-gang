Run the unit checks with `node --test tests/*.test.cjs`.

The multiplayer browser check uses three isolated browser contexts and mocked Firebase and slide services. It creates no live rooms. With Playwright and Chromium installed, run `node tests/game-flow.browser.cjs`; set `CHROMIUM_PATH` if Chromium is installed elsewhere. It covers QR joining, persisted lobby settings, shared timers, refresh recovery, late joining, results, CSV exports, mobile layout and rematches. Screenshots are written under `/tmp`.

Install the pinned prerequisites with `pnpm install --frozen-lockfile` and `pnpm exec playwright install chromium`. Both browser checks support `CHROMIUM_PATH`, use `/usr/bin/chromium` if available, or otherwise use Playwright's downloaded browser.

Run `node tests/spectator-flow.browser.cjs` for audience-only fixtures, concurrency, accepted-vote recovery, shared timer/slide/veto/notes transitions, missing rooms, rematches and mobile checks. It asserts no spectator registrations or Google Slides/image-service requests. Run `pnpm test:rules` with Java 21+ to exercise the Firebase rules against the local database emulator, including concurrent ETag transactions and writes rejected at commit time. See [spectator setup and limitations](../SPECTATOR-VOTING.md).

The spectator browser suite also checks that audience pages omit the code and that invite-only lobbies accept private links while rejecting code-only, tampered and rotated invitations. It covers host/player refresh, QR links, separate spectator links, mobile layout and invite-only rematches. All requests use fixtures; it does not change live rooms or database rules.

Stability coverage includes failed Firebase SDK downloads and connection retry, failed host slide loading and retry, results appearing without a one-off database read, final vote updates arriving after results, and deleted-room recovery. Unit checks also exercise room-read timeouts, abandoned refresh attempts, delayed votes across slide/room changes, and vetoes racing with slide advancement.

Slide-loading checks cover interruption and resumption of running preloads, promotion races, cancellation of obsolete running work, shorter foreground/background service limits, randomized retry delays, cancellation during a retry, same-URL recovery for slow image downloads, and the total image-load deadline.

Security migration: the app now uses Firebase Anonymous Authentication. `pnpm test:rules` starts both Auth and Database emulators, verifies actual authenticated REST requests (including host takeover, own/foreign writes, private invitation proofs, immutable votes and atomic Double Down), then runs `security-flow.emulator.browser.cjs` with the real Firebase SDK. The latter permits only loopback Firebase endpoints and mocks the slide service. See [permissions and rollout](../SECURITY.md). Existing unauthenticated rooms cannot safely be migrated or claimed; start fresh rooms after deployment.
