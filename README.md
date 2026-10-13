# Tiny Gang

The home page offers two activities:

- **Smash or Pass** (`smash-or-pass.html`): the multiplayer game, including host, participant and spectator views.
- **Origin Builder** (`origin-workshop.html`): a browser-local Minecraft origin designer with 129 traits, 16 examples, adjustable powers and weaknesses, free cosmetics and custom ideas. Points and rules are discussion proposals.

Both activities link back to the home page. Existing links to `/?room=...`, including private invitation fragments and spectator parameters, redirect to the game with their full query and fragment preserved. Saved game sessions resume when the visitor opens Smash or Pass.

## Hosting

GitHub Pages publishes the repository root on `main`. No build step is required. Keep `index.html`, `smash-or-pass.html`, `origin-workshop.html` and the existing `assets/` folder together. Updating the game does not require changing the home page.

Origin drafts are stored in each visitor's browser. Copying and downloading a build lets players send it to the server owner; there is no automatic submission service. A draft from the earlier local-file builder can be carried over using Download build file, then Load a build file on the hosted builder.

The game still uses its existing Firebase and Google Slides services. See [security and setup](SECURITY.md) before making backend changes. Origin Builder and the home page do not use those services.

## Checks

See [tests/README.md](tests/README.md) for game regression checks. `node tests/activity-hub.browser.cjs` checks activity navigation, legacy invites, builder draft recovery, refund cancellation, mobile layout and keyboard access without connecting to live services.
