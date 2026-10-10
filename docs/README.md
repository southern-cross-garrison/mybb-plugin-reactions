# Reactions Guide

The user guide for the plugin, built with [Starlight](https://starlight.astro.build/) and
published to GitHub Pages by `.github/workflows/docs.yml` on every push to `main` that
touches `docs/`.

```bash
cd docs
pnpm install
pnpm dev           # http://localhost:4321/
pnpm build         # what CI runs
```

## Layout

| Folder                            | Audience                                 |
| --------------------------------- | ---------------------------------------- |
| `src/content/docs/members/`       | Members reacting to posts                |
| `src/content/docs/admins/`        | Administrators with Admin CP access      |
| `src/content/docs/webmasters/`    | Whoever installs and upgrades the plugin |
| `src/assets/screenshots/<guide>/` | Screenshots, generated (see below)       |
| `screenshots/`                    | The Playwright scripts that take them    |

A new page is a new `.mdx` file in the right folder; the sidebar picks it up. Set
`sidebar.order` in its frontmatter to place it. Each `##` heading is a deep link that gets
pasted into forum posts, so don't reword one once it's published without checking for links
to it.

## Screenshots

Screenshots are taken by Playwright against the dev forum, with the e2e suite's fixtures and
logins, so the public guide never shows a real member's details. The ring around the thing
to click is drawn by the script, so after a UI change you re-run the script rather than
re-taking and re-annotating pictures.

```bash
../scripts/bootstrap.sh    # if the dev forum isn't up
pnpm screenshots           # all guides
pnpm screenshots members   # one guide
```

This runs the repo root's Playwright, so it needs the root's `pnpm install` as well as this
folder's. Each `screenshots/<guide>.shots.ts` builds the state it needs with the e2e
helpers, then calls `ring(locator)` and `shot(area, '<guide>/<name>')` from
`screenshots/annotate.ts`. Commit the resulting PNGs with the page change.

`node social/render.mjs` regenerates `public/og-image.jpg`, the picture shown when a link to
the guide is shared.

## Publishing

The guide is configured for <https://reactions-guide.501scg.org>, which needs this one-off
setup:

- **Settings → Pages**: **Source** is **GitHub Actions**, and **Custom domain** is
  `reactions-guide.501scg.org` with **Enforce HTTPS** on.
- **DNS** for 501scg.org: a `CNAME` record from `reactions-guide` to
  `southern-cross-garrison.github.io`.
- `site` in `astro.config.mjs` is the domain, with no `base`.
