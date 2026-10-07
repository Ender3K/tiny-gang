Run the unit checks with `node --test tests/*.test.cjs`.

The multiplayer browser check uses three isolated browser contexts and mocked Firebase and slide services. It creates no live rooms. With Playwright and Chromium installed, run `node tests/game-flow.browser.cjs`; set `CHROMIUM_PATH` if Chromium is installed elsewhere. It covers QR joining, persisted lobby settings, shared timers, refresh recovery, late joining, results, CSV exports, mobile layout and rematches. Screenshots are written under `/tmp`.
