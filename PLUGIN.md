# MyBB Reactions Plugin

Facebook-style reactions on forum posts. Members react to a post with one of a set of
reactions you choose - Like, Love, Haha and so on - and every post shows how it has been
received.

## Features

- **One reaction per member per post.** Picking another switches to it; picking the same one
  again takes it back.
- **A quick reaction and a picker.** Clicking (or tapping) React adds the default reaction -
  Like, out of the box - or takes back the reaction you have. Pressing and holding the
  button, with the mouse or a finger, opens a picker with every reaction.
- **A summary on every post.** The post's most used reactions are pictured beside the
  number of reactions ("You and 3 others" when one of them is yours - and nothing when yours
  is the only one, since the button already shows it). Clicking it lists who reacted, with
  their avatars and a tab for each reaction.
- **Reactions you choose.** Add, rename, reorder, deactivate and delete reactions, and upload
  an image for each, under Configuration -> Reactions in the Admin CP.
- **Notifications.** A post's author gets a private message the first time each member reacts
  to it. Members can turn these off in their User CP.
- **Works without JavaScript, from the keyboard and on touch screens.**

## Requirements

- MyBB 1.8 (tested on 1.8.41).
- PHP 7.4 or later.
- A writable `uploads/` directory, which MyBB already needs for attachments.

## Installation

1. Upload the contents of the release zip to your forum's root directory. The zip's folders
   (`inc/`, `admin/`, `images/`, `jscripts/`) line up with your forum's own.
2. In the Admin CP, go to Configuration -> Plugins and click **Install & Activate** beside
   Reactions.

Installing creates the plugin's tables, settings, templates and stylesheet, and the six
default reactions. Activating adds the reactions bar to your themes' post templates.

## Upgrading

Upload the new release over the old one, then deactivate and activate the plugin in
Configuration -> Plugins. Activating brings the database, templates, stylesheet and settings
up to date; your reactions, and every member's reactions to posts, are kept.

## Uninstalling

Deactivating takes the bar out of posts and keeps everything else, so activating again
brings it all back. Uninstalling removes everything: the tables (and so every reaction ever
made), the settings, the templates, the stylesheet, and the images you uploaded.

## Managing reactions

Configuration -> Reactions in the Admin CP lists the board's reactions, in the order the
picker shows them, with how many times each has been used.

- **Adding a reaction.** Give it a name of up to 50 characters and upload an image: a PNG,
  GIF, JPEG, WebP or SVG of up to 256 KB. Square images look best; they are shown at 18 pixels in a
  post's summary and 36 in the picker.
- **The default reaction** - the one a plain click on React adds - is the first active
  reaction in the list. Reorder the list to change it.
- **Deactivating** a reaction removes it from the picker and stops posts showing it. Members
  who reacted with it keep their reaction, hidden, and it comes back if you activate the
  reaction again.
- **Deleting** a reaction deletes every member's use of it, too. The confirmation says how
  many that is. Deactivate instead if you might want them back.

Images are uploaded to `uploads/reactions/`.

An SVG can carry script, which would run on your forum for anyone who opened the image
directly, so an uploaded SVG is cleaned before it is saved. Only drawing elements (shapes,
text, gradients, filters, clipping, animation) and their attributes are kept. Scripts, event
handlers such as `onload`, links, embedded HTML and images, external references, and CSS
that could fetch anything are removed. If anything was removed, the Admin CP says so when
you save. A file that isn't a valid SVG, or that declares a DOCTYPE, is refused. Cleaning
needs PHP's DOM extension, which almost every host has.

## Settings

Under Configuration -> Settings -> Reactions:

| Setting                             | Default | What it does                                                        |
| ----------------------------------- | ------- | ------------------------------------------------------------------- |
| Tell authors about reactions        | Yes     | Send an author a PM the first time each member reacts to their post |
| Reactions shown in a post's summary | 3       | How many of a post's most used reactions are pictured               |
| Largest reaction image (KB)         | 256     | The upload limit in the Admin CP                                    |

## Who can react

Any logged-in member who can see a post can react to it, including in closed threads, and
including to their own posts. Guests can see the summary and who reacted, but not react.
Members of a banned group cannot, because MyBB's Banned group cannot view the board.
Unapproved and soft-deleted posts cannot be reacted to.

Who reacted to a post can be seen by anyone who can see the post.

## Notifications

The first time a member reacts to a post, its author is sent a private message from that
member saying which reaction, with a link to the post. After that, the same member switching
reactions, or taking theirs back and adding it again, sends nothing more.

No PM is sent:

- for reactions to your own posts;
- when the setting is off;
- to a member who has turned them off ("Send me a private message when someone reacts to my
  posts", in User CP -> Edit Options);
- to a member who has PMs turned off, is ignoring the member who reacted, or only takes PMs
  from buddies when the member who reacted is not one.

No copy of the PM is kept in the reacting member's Sent Items.

## Styling and theming

The reactions bar is added to `postbit` and `postbit_classic` at the foot of the post's
content, after `{$post['iplogged']}` or `{$post['input_editreason']}`, whichever comes last,
and the notification option to the end of `usercp_options_pms`. If a
theme you add later is missing them, deactivate and activate the plugin to add them again.

The plugin's look is in the `reactions.css` stylesheet, attached to the master theme so every
theme inherits it. Edit a theme's copy under Templates & Style -> Themes to restyle it. Its
templates are in the Reactions group under Templates & Style -> Templates.

## Removing content

Reactions go with what they belong to: deleting a post or a thread deletes the reactions to
it, merging posts keeps the reactions to the post the others were merged into, and deleting
a member deletes the reactions they made.

## Database tables

| Table                       | Holds                                                    |
| --------------------------- | -------------------------------------------------------- |
| `reactions`                 | The reactions you have defined                           |
| `reactions_post`            | Each member's reaction to each post                      |
| `reactions_notified`        | Which members' reactions each author has been told about |
| `reactions_schema_upgrades` | Which schema upgrades the board has had                  |

The plugin also adds a `reactions_notify` column to `users`.

## License

Apache License 2.0 - see LICENSE and NOTICE. The default reaction images are
[Twemoji](https://github.com/jdecked/twemoji), licensed CC-BY 4.0.
