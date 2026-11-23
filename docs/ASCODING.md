# The Pantry on ASCoding

The Pantry is served from two addresses, built from this one repository:

| Address | Comes from |
|---|---|
| https://ngcoding10.github.io/recipes/ | this repo's GitHub Pages |
| https://ascoding11.github.io/recipes/ | the `ASCoding11/recipes` repo's `gh-pages` branch, written by this repo's deploy workflow |

Every push builds the site once and publishes **the same files** to both, so they never drift apart.
Both copies talk to the same Firebase project and the same Cloud Functions, so it is **one
account system**: someone who signs up on either address has the same account, pantry and saved
recipes on the other. (Browsers keep sign-in per address, so each person clicks *Sign in with
Google* once per address; it is the same account both times.) Search engines are told the
ngcoding10 address is the main one (canonical links), so the copy does not count as duplicate content.

This is the same way ASCoding already hosts Joukowsky-Dynamics: a separate `ASCoding11/<repo>`
GitHub Pages site appears at `ascoding11.github.io/<repo>/`. The ASCoding repository itself gets
only a card linking to it (pull request from `ngcoding10/ASCoding11.github.io`).

## One-time setup (about 10 minutes, two people)

### You (ngcoding10)

1. Make a deploy key on your computer:

   ```bash
   ssh-keygen -t ed25519 -N "" -C "ngcoding10/recipes → ASCoding11/recipes" -f ascoding_deploy
   ```

   This creates `ascoding_deploy` (private) and `ascoding_deploy.pub` (public).
2. Send **only `ascoding_deploy.pub`** to Arjun.
3. In **github.com/ngcoding10/recipes → Settings → Secrets and variables → Actions → New repository
   secret**: name `ASCODING_DEPLOY_KEY`, value = the whole contents of `ascoding_deploy` (the
   private file). Then delete both files from your computer.

### Arjun (ASCoding11)

1. Create a **public** repository `ASCoding11/recipes`, empty (no README).
2. In that repo: **Settings → Deploy keys → Add deploy key**: title `ngcoding10/recipes deploy`,
   paste `ascoding_deploy.pub`, tick **Allow write access**. This key can write to this one repo
   and nothing else.
3. Merge the pull request that adds The Pantry's card to ASCoding.

### Then

1. You: **ngcoding10/recipes → Actions → Deploy to GitHub Pages → Run workflow**. The
   `mirror-ascoding` job publishes the site to `ASCoding11/recipes` on a `gh-pages` branch.
2. Arjun: in `ASCoding11/recipes` → **Settings → Pages → Build and deployment → Deploy from a
   branch → `gh-pages` / `(root)` → Save**. About a minute later
   https://ascoding11.github.io/recipes/ is live.
3. Firebase (the shared backend, see [`BACKEND.md`](BACKEND.md)): **Authentication →
   Settings → Authorized domains** must list `ascoding11.github.io` as well as
   `ngcoding10.github.io`, and the backend's Cloud Functions must accept requests from both
   addresses.

From then on, every push to this repo updates both addresses. Nothing has to be done on ASCoding.

## Good to know

- The ASCoding repository must never get its own `recipes/` folder: the `ASCoding11/recipes` site
  owns that address.
- On the ASCoding copy, the footer shows a *Back to ASCoding* link.
- Storage on the shared ascoding11.github.io address is kept apart from ASCoding's games: The
  Pantry's browser keys all start with `pantry.`, and its Firebase sign-in is stored under its own
  project's key, so it cannot sign anyone in or out of ASCoding's games.
- To stop the ASCoding copy: delete the `ASCODING_DEPLOY_KEY` secret (the job then skips itself)
  and Arjun can archive `ASCoding11/recipes`.
