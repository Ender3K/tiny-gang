# Speaker-note timing

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

If the app cannot reach the slide service, open the deployment's `/exec` URL
in a signed-out/private browser window. The running script should return
`{"ok":false,"error":"Missing presentationId"}`. A 404 page means the URL does
not resolve to a usable public deployment; a sign-in page means its access
settings need updating. Use **Deploy → Manage deployments** to check the URL
and access settings.

The frontend continues to use the web app URL already in `index.html`. No new
API key or client-side access to speaker notes is required. The `meta` response
now includes `timingVersion: 1` and a `slideDurations` object keyed by one-based
slide numbers. Only resolved durations and timing warnings are sent to the app,
not the text of the speaker notes.

The app requests JSON with `fetch` and `credentials: "omit"`. This keeps the
public deployment independent of a player's signed-in Google accounts. Both
the Google redirect and its ContentService response support these anonymous
cross-origin GET requests. Each request bypasses cached redirects and has a
75-second timeout; a failed connection or temporary HTTP error retries once.
No callback parameter is required by the frontend. The script still supports
JSONP for older versions of the app.

Put one marker in the speaker notes for each slide that needs a timing change.
Markers can be on their own line or separated from other text by whitespace.

| Notes marker | Behavior |
| --- | --- |
| `#10` | Give this slide 10 seconds. |
| `#10<` | Start a 10-second range on this slide. |
| `#>` | End the current range after this slide, including this slide. |

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
