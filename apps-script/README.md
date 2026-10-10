# Slide service

Replace the code in the existing Google Apps Script project with `Code.gs`.
Then choose **Deploy → Manage deployments → Edit (pencil) → New version → Deploy**.
Update the existing deployment so its web app URL stays the same. Keep the
existing execution identity and access settings. Saving the script editor alone
does not update the deployed service.

The web app must execute as **Me** and allow access to **Anyone**, so players
can request slides without signing in to Google. If you create a new deployment
instead of editing the existing one, its Web app URL changes: update
`APPS_SCRIPT_WEBAPP_URL` in `index.html` to the new URL ending in `/exec` and
publish that change to GitHub Pages. The editor's `/dev` testing URL is not a
public deployment.

For shared slide images, add **Google Slides API** under **Services → +** in
the Apps Script editor before deploying the new version. For a standard Google
Cloud project, also enable Google Slides API in that project's API Library;
the default Apps Script project enables it when the service is added. The
existing script's presentation and external-request permissions are used.

The app prepares the first two slides in each player's lobby. During the game
it preloads two slides ahead, with at most two image loads running per browser.
The current slide takes priority over queued background loads and can interrupt
a running background load when both slots are occupied. Interrupted preloads
resume later through their original promise. Advancing slides cancels obsolete
queued and running loads; leaving a room cancels all that browser's pending work.
During gameplay, the nearest upcoming slide has priority over the farther
preload. If that nearest preload fails, the browser tries it once more after a
randomized 1.5–2.5 second delay while the same slide is still showing. The retry
is skipped when three seconds or less remain on an unpaused running countdown.
Pending retry waits are cancelled on slide changes, game end or leaving the room.
It remains background work that the current slide can interrupt. The lookahead
stays at two slides.

New clients request `action=image&format=url&cacheVersion=…`. The response
contains `imageUrl` and `expiresAt`. Apps Script caches the small Google Slides
thumbnail URL for 20 minutes and rechecks under a script lock so players share
one rendered image. Each lobby's metadata gets a fresh `imageCacheVersion`, so
new games reflect edited slides. Cached URLs refresh before expiry, and a
failed image URL is refreshed once. Google's image download is separate from
Apps Script; no full slide images are stored in Firebase or CacheService.

Apps Script's cache can evict entries early, in which case the thumbnail is
generated again. Older clients can still request the original base64 PNG
response without `format=url`. New clients also accept that older response,
so lobby preloading and the request limit work before the script is redeployed.
Shared URL caching requires the new deployment and Google Slides API.

If the app cannot reach the slide service, open the deployment's `/exec` URL
in a signed-out/private browser window. The running script should return
`{"ok":false,"error":"Missing presentationId"}`. A 404 page means the URL does
not resolve to a usable public deployment; a sign-in page means its access
settings need updating. Use **Deploy → Manage deployments** to check the URL
and access settings.

The frontend continues to use the web app URL already in `index.html`. No new
API key or client-side access to speaker notes is required. The `meta` response
now includes `timingVersion: 1` and a `slideDurations` object keyed by one-based
slide numbers. Only resolved durations, voting rules and warnings are sent to the app,
not the text of the speaker notes.

The app requests JSON with `fetch` and `credentials: "omit"`. This keeps the
public deployment independent of a player's signed-in Google accounts. Both
the Google redirect and its ContentService response support these anonymous
cross-origin GET requests. Each request bypasses cached redirects and has a
75-second timeout for deck metadata; a failed connection or temporary HTTP error
retries once. Slide image requests use 15-second service timeouts for the current
slide and 8-second service timeouts for background preloads. Current service
requests retry once, including timeouts, after a randomized 250–500 ms delay;
individual background service requests do not retry. The nearest failed
gameplay preload can make the separate delayed retry described above.
Image downloads time out after
10 seconds for the current slide or 8 seconds for a preload. A slow current
download retries the same URL once; a failed URL refreshes the thumbnail once
instead. Each queued image load has a 30-second total budget covering service
requests, retry delays and image downloads. Cancellation stops retries and
clears timers. These frontend limits need no Apps Script redeployment.
No callback parameter is required by the frontend. The script still supports
JSONP for older versions of the app.

Put one marker in the speaker notes for each slide that needs a timing change.
Markers can be on their own line or separated from other text by whitespace.

| Notes marker | Behavior |
| --- | --- |
| `#10` | Give this slide 10 seconds. |
| `#10<` | Start a 10-second range on this slide. |
| `#>` | End the current range after this slide, including this slide. |
| `!` | Disable voting on this slide only. |

Use `!` on its own line, or separated from other text by whitespace. Ordinary
punctuation such as `Hello!` does not disable voting. A slide can have both a
timing marker and `!`, for example `#10` and `!` on separate lines: the slide
stays visible for 10 seconds, but players and the host cannot Smash, Pass or
Double Down. Voting returns on the next slide unless it also has `!`.

Slides with `!` are unrated and excluded from scores, comparisons and rated
slide counts. They do not count as a missed vote. The host cannot enable voting
on these slides using the veto button; remove `!` from the notes and create a
new room to change the rule. Metadata includes `notesRulesVersion: 1` and a
`slideVotingDisabled` object keyed by one-based slide numbers. Deploy the new
`Code.gs` version to enable this marker; the previous timing-only deployment
does not send these rules.

For example, the notes `['', '#10<', '', '#20', '#>', '']` give slides 2, 3 and 5
10 seconds, and slide 4 gets 20 seconds. Slides 1 and 6 use the default timer.
A single-slide override does not change the surrounding range.

Durations are whole numbers from 1 to 3600 seconds. A range without an end marker
continues to the last slide. A new range replaces an existing range. Unmatched
end markers, invalid durations and multiple markers produce warnings shown to
the host in the lobby. Only the first marker on a slide is used.

Note timings enable a countdown for their slides even if the default timer is
off. Other slides follow the default timer setting. The countdown waits for the
slide image to load. Host adjustments still work during a round; they change
the current round and the default for subsequent slides without notes.

Create a new room after editing the deck's notes: timing is loaded when a room
is created. Existing rooms retain their original timings. Older deployments
continue to support the app's default timer and show that note timing is
unavailable.

After deploying, a `meta` request for a deck with timing markers should return
`timingVersion: 1` and the expected `slideDurations`. Open a new room and verify
the first and last slides of a range, plus the slide immediately after it.
