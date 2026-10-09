Run the unit checks with `node --test tests/*.test.cjs`.

The multiplayer browser check uses three isolated browser contexts and mocked Firebase and slide services. It creates no live rooms. With Playwright and Chromium installed, run `node tests/game-flow.browser.cjs`; set `CHROMIUM_PATH` if Chromium is installed elsewhere. It covers QR joining, persisted lobby settings, shared timers, refresh recovery, late joining, results, CSV exports, mobile layout and rematches. Screenshots are written under `/tmp`.

Install the pinned prerequisites with `pnpm install --frozen-lockfile` and `pnpm exec playwright install chromium`. Both browser checks support `CHROMIUM_PATH`, use `/usr/bin/chromium` if available, or otherwise use Playwright's downloaded browser.

Run `node tests/spectator-flow.browser.cjs` for audience-only fixtures, concurrency, accepted-vote recovery, shared timer/slide/veto/notes transitions, missing rooms, rematches and mobile checks. It asserts no spectator registrations or Google Slides/image-service requests. Run `pnpm test:rules` with Java 21+ to exercise the Firebase rules against the local database emulator, including concurrent ETag transactions and writes rejected at commit time. See [spectator setup and limitations](../SPECTATOR-VOTING.md).
