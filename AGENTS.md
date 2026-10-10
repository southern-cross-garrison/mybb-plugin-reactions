# Working on this repo

## Layout

- `plugin/` is the source of truth for the plugin. Nothing is edited inside `test-forum/`.
  It mirrors a MyBB forum root, which is how MyBB expects a plugin package to be laid out:
  deploying to real hosting is copying the contents of `plugin/` over the forum's root
  directory, and `scripts/deploy.sh` does exactly that. Anything that must not be uploaded
  to a web root (docs, tooling) stays out of `plugin/` - the plugin's documentation is
  `PLUGIN.md` and `docs/` for that reason.
  - `plugin/inc/plugins/reactions.php` - plugin metadata, file-level hook registration,
    install/activate/deactivate/uninstall.
  - `plugin/inc/plugins/reactions/inc/` - hooks (the only file loaded on every request),
    core functions, rendering, notifications, uploads, installers.
  - `plugin/inc/plugins/reactions/templates/` - templates as `.html` files, synced into the
    master template set on install/activate.
  - `plugin/inc/plugins/reactions/stylesheets/reactions.css` - synced into the master theme.
  - `plugin/inc/plugins/reactions/upgrades/` - schema upgrades (see below).
  - `plugin/admin/modules/config/reactions.php` - the Admin CP page, Configuration -> Reactions.
  - `plugin/inc/languages/english/` - front-end and Admin CP language strings.
  - `plugin/jscripts/reactions/` - the front-end script, and the Admin CP's CSS.
  - `plugin/images/reactions/` - the bundled default reaction images (Twemoji, CC-BY 4.0).
- `test-forum/` is a disposable MyBB tree (gitignored), built by `scripts/bootstrap.sh`.
- `tests/` is the Playwright end-to-end suite; `scripts/` holds the environment tooling;
  `docs/` is the user guide site.

## Everyday commands

```bash
./scripts/bootstrap.sh          # bring the environment up (first run, or after a wipe)
./scripts/bootstrap.sh --fresh  # wipe test-forum/ and the database and rebuild
./scripts/deploy.sh             # push plugin/ changes into test-forum/
pnpm test                       # run the suite
pnpm test:ui                    # run it interactively
```

After changing anything under `plugin/`, run `./scripts/deploy.sh`. After changing a
template, the stylesheet, or anything in `reactions_install()`/`reactions_activate()`, the
plugin has to be re-activated and the baseline re-taken - from a restored database, so the
last test run's leftovers are not baked in:

```bash
./scripts/db-restore.sh && ./scripts/deploy.sh \
  && docker compose exec -T web php /dev/stdin < scripts/provision.php \
  && ./scripts/db-snapshot.sh
```

## Things worth knowing

- The plugin has to run on PHP 7.4 (the garrison's host) and the latest 8.x, and CI runs
  the suite on both. Write for 7.4 - no `str_contains()`, `match`, `?->`, named arguments
  or other 8.x additions - and for 8's strictness: an undefined index or variable that 7.4
  reports as a notice MyBB ignores is a logged warning on 8, and every test fails on a
  logged warning. Run the suite on `PHP_VERSION=8.5` before calling a change done.
- Every postbit renders `{$post['reactions']}` once the template edit is in, including the
  ones the `postbit` hook does not run for (previews, PMs, announcements). Those get it set
  to `''` by `reactions_postbit_empty()`; a new kind of postbit needs the same.
- `insert_query()`/`update_query()` quote values but do not escape them. Every string from
  input or from board data goes through `$db->escape_string()`.
- Templates are eval'd strings with no logic. Anything conditional or repeated is built in
  PHP (`reactions_render.php`) and handed over as a variable, already escaped with
  `htmlspecialchars_uni()` - a reaction name is whatever an administrator typed.
- Front-end CSS goes in `reactions.css`, never in a `<style>` block in a template, so a
  theme can override it. Every rule is scoped to a `.reactions` class: the sheet is
  attached to every thread and every `misc.php` page. Admin CP CSS goes in
  `jscripts/reactions/reactions-admin.css`, linked through `$page->extra_header`.
- Hooks are registered at file level in `reactions.php` (and `reactions_register_hooks()`),
  never in `reactions_activate()`, which runs once.
- In the Admin CP, `verify_post_check()` returns false rather than stopping the page, so an
  action link (activate, deactivate) must act on its result. MyBB itself checks the key on
  every Admin CP POST. Tests follow action links with `followAdminActionLink()`, because a
  typed `goto()` sends the wrong `Sec-Fetch-Site` and would be refused whatever its key.
- Who may react is "logged in, and can see the post" (`reactions_get_viewable_post()`),
  checked at the endpoint as well as when drawing the bar. There is deliberately no ban
  check of its own: MyBB's Banned group cannot view the board.
- Raster uploads are checked with `getimagesize()` against their extension and stored as
  they came. Uploaded SVGs are never stored as they came: an SVG opened straight from
  `uploads/` runs its script on the forum's origin, so `reactions_sanitize_svg()` parses
  the file and rebuilds it from an allowlist of SVG-namespace drawing elements and safe
  attributes. Keep it an allowlist - widen it by adding a harmless element, never by
  carving an exception out of a check - and add the attack shape to
  `svg-sanitizing.spec.ts` whenever you touch it. Files with a DOCTYPE are refused before
  parsing (entity expansion). Only files directly inside `uploads/reactions/` are ever
  deleted (`reactions_delete_uploaded_image()`), never a bundled default.
- MyISAM has no transactions. The read-modify-write in `reactions_react()` holds a named
  `GET_LOCK` per member and post, and the once-per-pair notification claim is an
  `INSERT IGNORE`; keep any new check-then-write sequence under one or the other.
- Schema changes are a new file in `upgrades/` (`0001_something.php`, returning a closure
  that takes `$db`), never an edit to the `CREATE TABLE`s in `reactions_install_database()`
  once released. Every step in an upgrade is guarded so it can run twice; a table an
  upgrade creates is added to `reactions_plugin_tables()` so uninstall drops it.
- Links built for somewhere other than an HTML attribute - a `Location` header, a `[url]`
  in a PM - go through `reactions_post_url()`: `get_post_link()` returns `&amp;`.
- The suite holds a lock (`.devenv/suite.lock`) while it runs. Never delete it, and never
  run `db-restore.sh`, `db-snapshot.sh` or `provision.php` while a run holds it - each one
  pulls the database out from under the run.
- A test that changes something the per-test reset does not cover (a users row, a
  usergroup, a setting) puts it back in a `finally`, or with `withSettings()`.
- `plugin/inc/plugins/reactions/LICENSE` and `NOTICE` are copies of the root ones, shipped
  with the plugin; `plugin-setup.spec.ts` fails if they drift.

## Code style

PHP follows the surrounding code: four-space indents, braces on their own lines,
`if(`/`foreach(` with no space, `array()` rather than `[]`, double-quoted SQL with
`TABLE_PREFIX`, the `IN_MYBB` guard at the top of every file, and a docblock on every
function naming the hook it is for. Comments say why, in sentences. TypeScript is
formatted by Prettier (`pnpm format`).
