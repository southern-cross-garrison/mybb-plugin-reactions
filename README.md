# MyBB Reactions plugin

Facebook-style reactions for MyBB 1.8 posts. Administrators choose the reactions and upload
their images in the Admin CP; members pick one per post from a picker that opens when they
rest the mouse on the React button, or hold a finger on it. See [PLUGIN.md](PLUGIN.md) for
what the plugin does; this file covers the development environment and the test suite.

## Quick start

Requires Docker and pnpm 12+, which fetches the Node version the project pins.

```bash
pnpm install
pnpm exec playwright install chromium
./scripts/bootstrap.sh     # ~2 minutes on a cold start
pnpm test
```

`bootstrap.sh` downloads the pinned MyBB release into `test-forum/`, starts the containers,
runs MyBB's installer non-interactively, deploys the plugin, imports the garrison's custom
theme and the Smart Thread Link plugin it depends on, provisions the fixtures, and takes a
database snapshot the suite resets to.

When it finishes:

|            |                                                                                |
| ---------- | ------------------------------------------------------------------------------ |
| Forum      | <http://localhost:8090>                                                        |
| Admin CP   | <http://localhost:8090/admin/> - `admin` / `adminpass123`                      |
| Database   | `localhost:3317` - `mybb` / `mybbpassword`                                     |
| phpMyAdmin | `docker compose --profile tools up -d phpmyadmin` then <http://localhost:8091> |

The ports are deliberately not the events plugin's (8080/3307/8081), so the two
environments can run side by side. They come from `.env` (copy `.env.example`) if they
clash with something else.

## Development loop

```bash
./scripts/deploy.sh                  # copy plugin/ into test-forum/
pnpm test                            # whole suite, about two minutes
pnpm test react-flow                 # one spec
pnpm test:ui                         # interactive
pnpm exec playwright test --headed --debug -g "keyboard"
```

`plugin/` is the source of truth. Nothing is edited directly inside `test-forum/`.

Changing a template, the stylesheet, or anything in `reactions_install()` /
`reactions_activate()` needs the plugin re-activated and the baseline snapshot refreshed.
Templates and CSS are files in the repo but live in the database at runtime, so a plain
`deploy.sh` is not enough on its own. Restore first, so the snapshot does not pick up
whatever the last test run left behind:

```bash
./scripts/db-restore.sh
./scripts/deploy.sh
docker compose exec -T web php /dev/stdin < scripts/provision.php
./scripts/db-snapshot.sh
```

If the environment gets into a strange state, `./scripts/bootstrap.sh --fresh` rebuilds it
from nothing.

## PHP versions

The plugin supports PHP 7.4 (what the garrison's host runs) through the latest 8.x. The web
container runs 7.4 unless `PHP_VERSION` says otherwise, in `.env` or on the command line:

```bash
PHP_VERSION=8.5 ./scripts/bootstrap.sh
pnpm test
```

Each version builds its own image (`mybb-reactions-web:php<version>`). Run the suite on 8.x
before calling a change done: MyBB ignores notices, so on 7.4 an undefined variable in a
template is silent, while on 8 it is a logged warning - and every test fails on a logged
warning.

## The custom theme

The test forum runs the garrison's live theme rather than MyBB's default, so the suite
exercises the reactions bar against the markup it actually ships on; `themes.spec.ts`
switches a member to MyBB's default theme to check it there too. The theme comes from
[southern-cross-garrison/mybb-custom-theme][theme], pinned to a commit by `THEME_REF` in
[scripts/env.sh](scripts/env.sh), and is imported through MyBB's own ACP import code path.
To move to a newer commit, bump `THEME_REF` and re-import:

```bash
./scripts/install-theme.sh
docker compose exec -T web php /dev/stdin < scripts/provision.php   # re-applies the template edits
./scripts/db-snapshot.sh
```

The theme links threads with `{$thread['smartlink']}`, a variable from the [Smart Thread
Link][smartlink] plugin, so `scripts/install-smartlink.sh` installs that too, pinned by
`SMARTLINK_REF`. Without it no thread in a forum listing is clickable.

[theme]: https://github.com/southern-cross-garrison/mybb-custom-theme
[smartlink]: https://github.com/southern-cross-garrison/mybb-plugin-smartlink

## How the plugin gets into a post

The bar is `{$post['reactions']}`, added to `postbit` and `postbit_classic` by a template
edit on activation (and taken out on deactivation), straight after `{$post['signature']}`.
The signature is in every theme's postbit, and in both MyBB's and the garrison's it sits
below the message rather than inside it - which matters, because quick edit replaces the
message's container wholesale. The User CP opt-out is added to the end of
`usercp_options_pms` the same way.

The plugin's own templates live in the master template set, and its CSS in
[reactions.css](plugin/inc/plugins/reactions/stylesheets/reactions.css), installed on the
master theme as a real theme stylesheet, so a theme can override either from ACP >
Templates & Style. Colours lean on Bootstrap's custom properties where the theme has them.

## How the suite works

`tests/e2e/` drives a real browser against a real MyBB install. There is no mocking.

**Isolation.** The suite runs single-worker against one MyBB instance. Global setup restores
the provisioned database snapshot and caches a login for each fixture user. Before each test
every reaction is cleared, the six default reactions and members' notification preferences
are put back as provisioned, uploaded images are deleted, and the forums and every mailbox
are reset.

**Warnings fail tests.** The board logs PHP warnings and SQL errors rather than showing
them, and every test fails if anything was logged while it ran (`tests/helpers/fixtures.ts`).
A page can look right and still have raised one.

**Fixtures.** `scripts/provision.php` creates the users, a Staff Only forum, and threads to
react to, and writes `test-forum/reactions-fixtures.json` with their ids:

| User                    | Purpose                                                            |
| ----------------------- | ------------------------------------------------------------------ |
| `admin`                 | Admin CP access                                                    |
| `author`                | Wrote the posts the suite reacts to, so receives the notifications |
| `trooper1` - `trooper3` | Members who react                                                  |
| `optout`                | Has turned reaction notifications off                              |
| `staff`                 | The only member, the administrator aside, who can see Staff Only   |
| `banned`                | In MyBB's Banned group, which cannot view the board                |

"Reactions Test Thread" has three posts by `author` and one by `trooper1`; there is also a
closed thread and a thread in Staff Only. All users share the password `testpass123`.

## What is covered

| Spec              | Covers                                                                                                                                                                                   |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `plugin-setup`    | What install creates, the stylesheet's pages, deactivating and reactivating (template edits applied exactly once), uninstall leaving nothing                                             |
| `admin-reactions` | The Admin CP list and usage counts, adding with an upload, every upload refusal (non-images, wrong type, size), editing, replacing images, activating, ordering, deleting, the admin log |
| `svg-sanitizing`  | The SVG sanitizer against script, handlers, links, foreignObject, animations, external references, CSS and DOCTYPEs; an uploaded hostile SVG opened directly runs nothing                |
| `react-flow`      | Quick reaction, picking, switching, taking back, the summary's counts, wording and pictures                                                                                              |
| `picker`          | Hover timing, keyboard, closing, and on a touch screen tap versus press-and-hold                                                                                                         |
| `who-reacted`     | The popup and its tabs, guests, the page version without a script                                                                                                                        |
| `permissions`     | Guests, banned members, forums the member cannot see, post keys, GET, inactive or unknown reactions and posts, unapproved and deleted posts                                              |
| `notifications`   | The PM and its links, once per member per post, never for your own, the board setting, the User CP opt-out, ignore lists                                                                 |
| `cleanup`         | Deleting posts, threads and members, and merging posts                                                                                                                                   |
| `escaping`        | A reaction name full of markup, everywhere it appears                                                                                                                                    |
| `no-js`           | The whole flow as plain forms                                                                                                                                                            |
| `themes`          | Where the bar lands on the garrison theme and on MyBB's default and classic postbits                                                                                                     |
| `quick-reply`     | A post added without a reload gets a working bar                                                                                                                                         |
| `health`          | Every page the plugin touches, front end and Admin CP, renders without a logged warning                                                                                                  |

## Continuous integration

`.github/workflows/e2e.yml` runs the suite on every push and pull request, once on PHP 7.4
and once on 8.5, after linting every PHP file in `plugin/` and `scripts/`. It needs a
`THEME_TOKEN` secret: a fine-grained PAT with read-only Contents access to
`mybb-custom-theme` and `mybb-plugin-smartlink`, which are private.

Once both versions pass, the _Package the plugin_ job uploads the contents of `plugin/` as
the run's `mybb-plugin-reactions-<sha>` artifact - a zip that expands straight over a forum
root.

### Releasing

Bump `"version"` in `plugin/inc/plugins/reactions.php`, commit, then tag that commit to
match:

```bash
git tag v1.0.0
git push origin v1.0.0
```

Once both PHP versions pass, the _Publish the release_ job attaches
`mybb-plugin-reactions-<tag>.zip` to a GitHub Release. It refuses if the tag and the
plugin's version disagree.

`.github/workflows/docs.yml` builds the user guide in `docs/` and publishes it to GitHub
Pages.

## License

Apache License 2.0 - see [LICENSE](LICENSE) and [NOTICE](NOTICE). The default reaction
images are Twemoji, under CC-BY 4.0; see NOTICE.
