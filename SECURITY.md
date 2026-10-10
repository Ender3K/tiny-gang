# Firebase access and rollout

The app signs visitors into Firebase anonymously in the background. There is no login screen, email request or password. It waits for persisted Firebase authentication before reading a room or restoring a session. Host and player IDs are Firebase UIDs, not the old editable `sop-device` identifier. Browser UI checks are for feedback; Firebase rules enforce permissions for every client, including direct REST requests.

## Permissions

- An authenticated visitor can read a room when its code is known. Room codes and room metadata are not secrets; spectator links identify the room. Whole-database and collection listing are denied.
- Only the existing host can write game settings, slides, timers, kicks, invitation configuration and rematch links. Room creation requires the caller's UID as host, and host ownership cannot change.
- Players can add/edit their own bounded profile. Firebase checks open joining, invitation proof, kick status and their immutable joining slide. Late joins write only their profile and their current-round eligibility, never the entire room. The UI checks duplicate display names; display names confer no permissions.
- Player votes require active, non-kicked membership and current-round eligibility. Each identity can write its own first choice only, with a running round, valid deadline, and no veto/notes restriction. This applies to hosts too: hosts cannot rewrite other people's accepted votes.
- Double Down writes `votes/CODE/SLIDE/UID = supersmash` and `ddused/CODE/UID = SLIDE` atomically. Rules cross-check the proposed values and deny repeated use, mismatched markers, standalone bonus votes and deletion. The marker is now a slide number, not the old boolean.
- Audience votes use the authenticated UID, are first-write-only, and obey the same round/time checks. An arbitrary browser ID cannot create extra votes under one identity.
- The raw invitation is stored under `roomInvites/CODE`, readable/writable only by the host. A valid invitation must be submitted to `joinProofs/CODE/UID`, readable only by that UID, before initial membership can be created. The public hash is not accepted as a credential. Rotation invalidates pending proofs; existing members remain admitted. Both paths are denied at collection/root level, and neither is nested under publicly readable room metadata.
- New rooms have `securityVersion: 2`. Existing rooms without it cannot be upgraded or claimed by an untrusted browser. They allow authenticated room-metadata reads but deny gameplay writes and vote reads.

Firebase anonymous authentication proves identity, not one human per account. Another browser/account can join public-code games or cast an audience vote. App Check and sensible quotas are additional abuse controls, not replacements for these rules. Losing the host's persisted Firebase identity loses control of that host's old rooms; copied app session data cannot recover it.

## Activate on the existing project

1. Finish active games and save a copy of the live Realtime Database rules. The identity migration intentionally requires new lobbies; do not attempt to assign old host IDs to new Firebase users through the client.
2. In Firebase Console, select `smash-or-pass-bb76b`. Open **Authentication → Sign-in method**, enable **Anonymous**, and save. If Authentication has not been initialized, select **Get started** first. No other provider is required.
3. Check the web API key under **Google Cloud Console → APIs & Services → Credentials**. Keep it restricted to the Firebase APIs in use, including Firebase Authentication's Identity Toolkit and Token Service APIs. Do not share this key with Gemini or unrelated billable APIs. The Firebase client key and project identifiers remain public by design; frontend environment files would not hide them.
4. During a short maintenance window, publish the complete [`firebase/database.rules.json`](firebase/database.rules.json) under **Realtime Database → Rules**, then deploy the updated `index.html` and existing assets to GitHub Pages. Alternatively, an authorized Firebase CLI session can run `firebase deploy --only database --project smash-or-pass-bb76b`. Rules-first closes the previous access holes immediately; the old page will stop working until the updated page is live. If this database serves another application, review its separate paths before replacing the rules; this ruleset denies unrelated paths.
5. Refresh the deployed page and create a fresh disposable lobby. Verify host refresh, a player joining from another browser, a normal vote and Double Down, and an audience vote. Repeat for an invite-only lobby, rotate its invitation and verify the old invite no longer admits a new member. Confirm rematches preserve the group. Delete disposable data through privileged console/Admin access after testing.

The repository change alone does not enable Authentication or publish live rules. No production console settings or deployment are performed by automated tests.

## Verification

Install pinned dependencies with `pnpm install --frozen-lockfile`. Use Java 21+ and Playwright Chromium (or set `CHROMIUM_PATH`). Run:

```sh
pnpm test
pnpm test:browser
pnpm test:rules
```

The last command starts Auth and Database emulators using `demo-tiny-gang`. It runs adversarial authenticated REST tests and then the actual Firebase SDK in isolated browser profiles. Tests refuse non-loopback Firebase endpoints; Google Slides requests are fixtures. The SDK test downloads official public Firebase JS from Google's CDN, so the first run needs network access.

## Separate service boundary

These changes secure Firebase game writes and private invitation material. They do not change Google Apps Script's deployed service. Its source currently accepts supplied presentation IDs and reads them using the script owner's permissions. Before treating the overall site as hardened, restrict that service to approved decks or move slide access to a backend that verifies authorization. Do not assume Firebase rules or a private GitHub repository protect this separate endpoint.

Official references: [anonymous authentication](https://firebase.google.com/docs/auth/web/anonymous-auth), [database rule conditions](https://firebase.google.com/docs/database/security/rules-conditions), [Firebase API keys](https://firebase.google.com/docs/projects/api-keys), [App Check](https://firebase.google.com/docs/app-check/web/recaptcha-enterprise-provider).
