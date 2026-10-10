<?php
/**
 * MyBB Reactions Plugin
 */

if(!defined("IN_MYBB"))
{
    die("Direct initialization of this file is not allowed.");
}

require_once MYBB_ROOT . "inc/plugins/reactions/inc/reactions_hooks.php";

global $plugins;

// Content goes away from both contexts: a moderator deletes a post from the front end, an
// administrator deletes a member from the Admin CP, and the user-pruning task deletes
// members from whatever page view happens to run it. Each takes its reactions with it.
$plugins->add_hook("class_moderation_delete_post", "reactions_post_deleted");
$plugins->add_hook("class_moderation_delete_thread_start", "reactions_thread_deleting");
$plugins->add_hook("class_moderation_delete_thread", "reactions_thread_deleted");
$plugins->add_hook("class_moderation_merge_posts", "reactions_posts_merged");
$plugins->add_hook("datahandler_user_delete_content", "reactions_users_deleted");

if(defined('IN_ADMINCP'))
{
    // The Reactions page lives under Configuration, beside Smilies and Post Icons. It
    // deliberately declares no admin permission: anyone who can reach the Admin CP may
    // manage reactions. A declared permission starts out as "No" for every administrator
    // whose permissions were saved before the plugin arrived, which hides the page from
    // everyone but the super admins until someone goes and grants it.
    $plugins->add_hook("admin_config_menu", "reactions_admin_config_menu");
    $plugins->add_hook("admin_config_action_handler", "reactions_admin_config_action_handler");
    $plugins->add_hook("admin_tools_get_admin_log_action", "reactions_admin_log_action");
}
else
{
    // MyBB includes active plugin files on every request, so this is where front-end
    // hooks belong - registering them in reactions_activate() would only run once.
    reactions_register_hooks();
}

/**
 * Plugin information.
 *
 * @return array
 */
function reactions_info()
{
    return array(
        "name"          => "Reactions",
        "description"   => "Facebook-style reactions on posts. Administrators choose the reactions and their images; members pick one per post.",
        "website"       => "https://github.com/southern-cross-garrison/mybb-plugin-reactions",
        "author"        => "Kevin Brown (TK-33151)",
        "authorsite"    => "https://www.501scg.org/",
        "version"       => "1.0.2",
        "guid"          => "4f0e60c5-a62e-4689-8465-17e7f540bb62",
        "codename"      => "reactions",
        "compatibility" => "18*"
    );
}

/**
 * @return bool
 */
function reactions_is_installed()
{
    global $db;

    return $db->table_exists('reactions');
}

/**
 * Create the plugin's tables, settings, templates, stylesheet and default reactions.
 */
function reactions_install()
{
    require_once MYBB_ROOT . "inc/plugins/reactions/inc/reactions_install.php";
    require_once MYBB_ROOT . "inc/plugins/reactions/inc/reactions_templates.php";
    require_once MYBB_ROOT . "inc/plugins/reactions/inc/reactions_stylesheets.php";

    // The baseline schema, then every upgrade since - the same steps an installed board
    // takes on activation.
    reactions_install_database();
    reactions_upgrade_database();
    reactions_install_templates();
    reactions_install_stylesheet();
    reactions_install_settings();
    reactions_install_default_reactions();
}

/**
 * Activate: bring the schema, templates, stylesheet and settings up to date, and add the
 * reactions bar to the post templates.
 */
function reactions_activate()
{
    require_once MYBB_ROOT . "inc/plugins/reactions/inc/reactions_install.php";
    require_once MYBB_ROOT . "inc/plugins/reactions/inc/reactions_templates.php";
    require_once MYBB_ROOT . "inc/plugins/reactions/inc/reactions_stylesheets.php";

    // MyBB has no upgrade hook, so schema changes land here - _install() only ever runs
    // once, on a board that has no tables yet.
    reactions_upgrade_database();

    // Re-sync templates so editing a .html file and re-activating picks up the change.
    reactions_install_templates();
    reactions_install_stylesheet();
    reactions_install_settings();
    reactions_apply_template_edits();
    reactions_rebuild_cache();
}

/**
 * Deactivate: take the reactions bar back out of the post templates. Everything else -
 * the reactions themselves, and every member's reaction to every post - is kept.
 */
function reactions_deactivate()
{
    require_once MYBB_ROOT . "inc/plugins/reactions/inc/reactions_templates.php";

    reactions_revert_template_edits();
}

/**
 * Remove every trace of the plugin.
 */
function reactions_uninstall()
{
    require_once MYBB_ROOT . "inc/plugins/reactions/inc/reactions_uninstall.php";
    require_once MYBB_ROOT . "inc/plugins/reactions/inc/reactions_templates.php";
    require_once MYBB_ROOT . "inc/plugins/reactions/inc/reactions_stylesheets.php";

    // Uninstalling an active plugin deactivates it first, but a board can also uninstall
    // one that is already inactive - and a template edit left behind would print an empty
    // variable into every post for good.
    reactions_revert_template_edits();
    reactions_uninstall_database();
    reactions_uninstall_templates();
    reactions_uninstall_stylesheet();

    rebuild_settings();
}
