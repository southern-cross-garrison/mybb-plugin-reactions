<?php
/**
 * MyBB Reactions Plugin - Installation
 *
 * The schema, the schema upgrade runner, the settings and the reactions a new board
 * starts with.
 */

if(!defined("IN_MYBB"))
{
    die("Direct initialization of this file is not allowed.");
}

require_once MYBB_ROOT . "inc/plugins/reactions/inc/reactions_functions.php";

/**
 * Every table the plugin owns, unprefixed. Uninstall walks this list, so a table added
 * here is dropped with the rest.
 */
function reactions_plugin_tables()
{
    return array(
        'reactions',
        'reactions_post',
        'reactions_notified',
        'reactions_schema_upgrades'
    );
}

/**
 * The character set every plugin table is created with.
 *
 * utf8mb4 regardless of the board's own connection encoding: MySQL's `utf8` cannot hold
 * an emoji, and a reaction named "🔥 Fire" is exactly what an administrator will try.
 * The collation matches what MyBB itself creates its utf8mb4 tables with.
 */
function reactions_table_charset()
{
    return "DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci";
}

/**
 * Create the baseline schema.
 *
 * Frozen once released. Do not edit these CREATE TABLEs to change the schema - add an
 * upgrade file instead (see reactions_upgrade_database()), which reactions_install()
 * runs straight after this, so a new board gets the change by the same step an existing
 * one does.
 */
function reactions_install_database()
{
    global $db;

    $charset = reactions_table_charset();

    // The reactions an administrator has defined. `image` is a path relative to the forum
    // root: the bundled defaults live under images/reactions/, uploads under
    // uploads/reactions/.
    $db->write_query("CREATE TABLE IF NOT EXISTS `" . TABLE_PREFIX . "reactions` (
        `rid` int(10) unsigned NOT NULL AUTO_INCREMENT,
        `name` varchar(50) NOT NULL DEFAULT '',
        `image` varchar(255) NOT NULL DEFAULT '',
        `disporder` smallint(5) unsigned NOT NULL DEFAULT 0,
        `active` tinyint(1) NOT NULL DEFAULT 1,
        PRIMARY KEY (`rid`)
    ) ENGINE=MyISAM {$charset};");

    // One row per member per post: the unique key is what makes a reaction a choice
    // rather than a tally, and it is what the read-modify-write in reactions_react()
    // leans on if two requests from the same member ever slip past its lock.
    $db->write_query("CREATE TABLE IF NOT EXISTS `" . TABLE_PREFIX . "reactions_post` (
        `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
        `pid` int(10) unsigned NOT NULL DEFAULT 0,
        `uid` int(10) unsigned NOT NULL DEFAULT 0,
        `rid` int(10) unsigned NOT NULL DEFAULT 0,
        `dateline` int(10) unsigned NOT NULL DEFAULT 0,
        PRIMARY KEY (`id`),
        UNIQUE KEY `pid_uid` (`pid`, `uid`),
        KEY `pid_rid` (`pid`, `rid`),
        KEY `uid` (`uid`)
    ) ENGINE=MyISAM {$charset};");

    // Who has already been told about whose reaction. Kept apart from reactions_post so
    // that removing a reaction and adding it back - or switching between two - does not
    // send the author a second PM about the same member and the same post.
    $db->write_query("CREATE TABLE IF NOT EXISTS `" . TABLE_PREFIX . "reactions_notified` (
        `pid` int(10) unsigned NOT NULL DEFAULT 0,
        `uid` int(10) unsigned NOT NULL DEFAULT 0,
        PRIMARY KEY (`pid`, `uid`),
        KEY `uid` (`uid`)
    ) ENGINE=MyISAM {$charset};");

    // A member's own opt-out from reaction PMs, on the users row like MyBB's own
    // notification preferences, so the User CP options page can read it with the rest.
    if(!$db->field_exists('reactions_notify', 'users'))
    {
        $db->write_query("ALTER TABLE `" . TABLE_PREFIX . "users` ADD `reactions_notify` tinyint(1) NOT NULL DEFAULT 1");
    }

    reactions_create_schema_upgrades_table();
}

/**
 * Which schema upgrades a board has had, one row per file in upgrades/.
 */
function reactions_create_schema_upgrades_table()
{
    global $db;

    $charset = reactions_table_charset();

    $db->write_query("CREATE TABLE IF NOT EXISTS `" . TABLE_PREFIX . "reactions_schema_upgrades` (
        `name` varchar(191) NOT NULL,
        `applied_at` int(10) unsigned NOT NULL DEFAULT 0,
        PRIMARY KEY (`name`)
    ) ENGINE=MyISAM {$charset};");
}

/**
 * Every schema upgrade the plugin ships, in the order they run.
 *
 * One file each in upgrades/, named with a zero-padded sequence number first
 * (0001_add_reaction_colour.php) so that sorting by name is sorting by age. A file
 * returns a closure that makes the change; it does not define a function, so two
 * upgrades can never collide over a name.
 *
 * @return array Upgrade name (the file name without .php) => path
 */
function reactions_schema_upgrades()
{
    $upgrades = array();
    foreach((array)glob(MYBB_ROOT . "inc/plugins/reactions/upgrades/*.php") as $path)
    {
        $upgrades[basename($path, '.php')] = $path;
    }

    ksort($upgrades, SORT_STRING);

    return $upgrades;
}

/**
 * Bring the board's schema up to date.
 *
 * MyBB gives plugins no upgrade hook and CREATE TABLE IF NOT EXISTS will not add a
 * column, so this runs on every activation as well as straight after install: each file
 * in upgrades/ the board has not had yet is run, oldest first, and recorded. Each upgrade
 * must be safe to run again, every step guarded on its own: MyISAM has no transactions,
 * and an upgrade is recorded only after it finishes, so one interrupted halfway runs
 * again from the top on the next activation.
 */
function reactions_upgrade_database()
{
    global $db;

    reactions_create_schema_upgrades_table();

    $applied = array();
    $query = $db->simple_select("reactions_schema_upgrades", "name");
    while($row = $db->fetch_array($query))
    {
        $applied[$row['name']] = true;
    }

    foreach(reactions_schema_upgrades() as $name => $path)
    {
        if(isset($applied[$name]))
        {
            continue;
        }

        $upgrade = require $path;
        if(!is_callable($upgrade))
        {
            // A file that forgot its return would otherwise be recorded as done without
            // having changed anything.
            trigger_error("Reactions plugin upgrade {$name} does not return a closure.", E_USER_ERROR);
        }

        $upgrade($db);

        $db->replace_query("reactions_schema_upgrades", array(
            'name'       => $db->escape_string($name),
            'applied_at' => TIME_NOW,
        ));
    }
}

/**
 * Create any of the plugin's settings the board does not have yet.
 *
 * Called from both install and activate, so a setting added in a later version reaches a
 * board that already has the plugin. Existing settings are left alone, values and all.
 */
function reactions_install_settings()
{
    global $db;

    $query = $db->simple_select("settinggroups", "gid", "name = 'reactions'");
    $group = $db->fetch_array($query);
    if($group)
    {
        $gid = (int)$group['gid'];
    }
    else
    {
        $db->insert_query("settinggroups", array(
            "name"        => "reactions",
            "title"       => $db->escape_string("Reactions"),
            "description" => $db->escape_string("How post reactions behave. The reactions themselves are managed under Configuration -> Reactions."),
            "disporder"   => 50,
            "isdefault"   => 0
        ));
        $gid = (int)$db->insert_id();
    }

    $settings = array(
        array(
            "name"        => "reactions_notify_pm",
            "title"       => "Tell authors about reactions",
            "description" => "Send a post's author a private message the first time each member reacts to it. Members can still turn these off for themselves in their User CP options.",
            "optionscode" => "yesno",
            "value"       => "1",
            "disporder"   => 1,
        ),
        array(
            "name"        => "reactions_summary_icons",
            "title"       => "Reactions shown in a post's summary",
            "description" => "How many of a post's most used reactions are pictured beside its reaction count.",
            "optionscode" => "numeric\nmin=1\nmax=20",
            "value"       => "3",
            "disporder"   => 2,
        ),
        array(
            "name"        => "reactions_max_upload_kb",
            "title"       => "Largest reaction image (KB)",
            "description" => "The biggest image an administrator can upload for a reaction.",
            "optionscode" => "numeric\nmin=1",
            "value"       => "256",
            "disporder"   => 3,
        ),
    );

    foreach($settings as $setting)
    {
        if($db->num_rows($db->simple_select("settings", "sid", "name = '" . $db->escape_string($setting['name']) . "'")) > 0)
        {
            continue;
        }

        // insert_query() quotes values but does not escape them.
        $db->insert_query("settings", array(
            'name'        => $db->escape_string($setting['name']),
            'title'       => $db->escape_string($setting['title']),
            'description' => $db->escape_string($setting['description']),
            'optionscode' => $db->escape_string($setting['optionscode']),
            'value'       => $db->escape_string($setting['value']),
            'disporder'   => (int)$setting['disporder'],
            'gid'         => $gid,
        ));
    }

    rebuild_settings();
}

/**
 * The reactions a new board starts with: Facebook's six, pictured with Twemoji (CC-BY
 * 4.0, credited in NOTICE). They are ordinary reactions from here on - an administrator
 * can rename, reorder, deactivate or delete any of them.
 *
 * @return array
 */
function reactions_default_reactions()
{
    return array(
        array('name' => 'Like',  'image' => 'images/reactions/like.svg'),
        array('name' => 'Love',  'image' => 'images/reactions/love.svg'),
        array('name' => 'Haha',  'image' => 'images/reactions/haha.svg'),
        array('name' => 'Wow',   'image' => 'images/reactions/wow.svg'),
        array('name' => 'Sad',   'image' => 'images/reactions/sad.svg'),
        array('name' => 'Angry', 'image' => 'images/reactions/angry.svg'),
    );
}

/**
 * Seed the default reactions, unless the board already has some.
 */
function reactions_install_default_reactions()
{
    global $db;

    if($db->num_rows($db->simple_select("reactions", "rid", "", array('limit' => 1))) > 0)
    {
        return;
    }

    $disporder = 1;
    foreach(reactions_default_reactions() as $reaction)
    {
        $db->insert_query("reactions", array(
            'name'      => $db->escape_string($reaction['name']),
            'image'     => $db->escape_string($reaction['image']),
            'disporder' => $disporder++,
            'active'    => 1,
        ));
    }

    reactions_rebuild_cache();
}
