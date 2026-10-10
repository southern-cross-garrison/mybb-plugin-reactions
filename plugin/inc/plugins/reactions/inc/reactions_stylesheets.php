<?php
/**
 * MyBB Reactions Plugin - Stylesheet installation
 *
 * The plugin's CSS lives as a .css file under reactions/stylesheets/ so it can be edited in
 * the repo, but MyBB serves stylesheets out of the `themestylesheets` table. These helpers
 * sync the file into the master theme (tid 1), which every other theme inherits from.
 *
 * Installing it as a real theme stylesheet - rather than inlining a <style> block into the
 * templates - is what lets a theme skin the plugin: an inherited stylesheet shows up in
 * ACP > Templates & Style > Themes like any other, and a theme that edits its copy (or
 * ships one in its export) takes over from the plugin's default without touching it.
 */

if(!defined("IN_MYBB"))
{
    die("Direct initialization of this file is not allowed.");
}

define('REACTIONS_STYLESHEET', 'reactions.css');

// The pages the stylesheet is loaded on, matched by MyBB against THIS_SCRIPT: threads,
// where the bar is, and misc.php, which serves the "who reacted" page. Both reach far
// more than the plugin's own markup - misc.php is a dozen unrelated pages - so nothing in
// the sheet may apply outside the .reactions classes.
define('REACTIONS_STYLESHEET_ATTACHEDTO', 'showthread.php|misc.php');

/** The theme every other theme inherits from. */
define('REACTIONS_MASTER_THEME', 1);

/**
 * The Admin CP directory, with a trailing slash.
 *
 * A board may rename it, so it is never hard-coded as admin/. Inside the Admin CP,
 * MYBB_ADMIN_DIR is the directory actually being served; from the CLI (provisioning) the
 * config is all there is, which is how MyBB's own css.php and tasks find it.
 */
function reactions_admin_dir()
{
    global $mybb;

    if(defined('MYBB_ADMIN_DIR'))
    {
        return MYBB_ADMIN_DIR;
    }

    return MYBB_ROOT . $mybb->config['admin_dir'] . '/';
}

/**
 * Install (or refresh) the plugin's stylesheet on the master theme.
 *
 * Safe to call repeatedly - the existing row is updated in place, so editing the .css file
 * and re-activating the plugin picks the change up, exactly like the templates.
 */
function reactions_install_stylesheet()
{
    global $db;

    // update_theme_stylesheet_list() and cache_stylesheet() are ACP functions. The plugin is
    // normally installed from the Admin CP, where they are already loaded, but provisioning
    // scripts call reactions_activate() from the CLI, so pull them in either way.
    require_once reactions_admin_dir() . "inc/functions_themes.php";

    $css = file_get_contents(MYBB_ROOT . "inc/plugins/reactions/stylesheets/" . REACTIONS_STYLESHEET);
    if($css === false)
    {
        return;
    }

    $row = array(
        "name"         => $db->escape_string(REACTIONS_STYLESHEET),
        "tid"          => REACTIONS_MASTER_THEME,
        "attachedto"   => $db->escape_string(REACTIONS_STYLESHEET_ATTACHEDTO),
        "stylesheet"   => $db->escape_string($css),
        "cachefile"    => $db->escape_string(REACTIONS_STYLESHEET),
        "lastmodified" => TIME_NOW
    );

    $existing = $db->fetch_array($db->simple_select("themestylesheets", "sid",
        "name = '" . $db->escape_string(REACTIONS_STYLESHEET) . "' AND tid = " . REACTIONS_MASTER_THEME));

    if($existing)
    {
        $db->update_query("themestylesheets", $row, "sid = " . (int)$existing['sid']);
    }
    else
    {
        $db->insert_query("themestylesheets", $row);
    }

    // A theme that has customised the sheet has a row of its own, which MyBB serves in
    // place of the master's - and that row carries its own copy of attachedto, taken when
    // it was made. Left alone, a page added to the list above reached every theme but
    // those, and on them rendered unstyled. Only the page list is brought up to date: the
    // CSS in that row is the theme's, and overwriting it would undo the customisation.
    $db->update_query(
        "themestylesheets",
        array("attachedto" => $db->escape_string(REACTIONS_STYLESHEET_ATTACHEDTO)),
        "name = '" . $db->escape_string(REACTIONS_STYLESHEET) . "' AND tid != " . REACTIONS_MASTER_THEME
    );

    // Write the flat cache file MyBB serves in preference to css.php, then rebuild the
    // per-theme stylesheet lists - every theme's, since the call walks the master's
    // children, which is what puts the copies' new attachedto into effect. That is what adds the sheet to each theme's display
    // order - a stylesheet missing from disporder is silently never output.
    cache_stylesheet(REACTIONS_MASTER_THEME, REACTIONS_STYLESHEET, $css);
    update_theme_stylesheet_list(REACTIONS_MASTER_THEME, false, true);
}

/**
 * Remove the plugin's stylesheet, including any theme's customised copy of it.
 */
function reactions_uninstall_stylesheet()
{
    global $db;

    require_once reactions_admin_dir() . "inc/functions_themes.php";

    $query = $db->simple_select("themestylesheets", "tid", "name = '" . $db->escape_string(REACTIONS_STYLESHEET) . "'");
    while($sheet = $db->fetch_array($query))
    {
        @unlink(MYBB_ROOT . "cache/themes/theme" . (int)$sheet['tid'] . "/" . REACTIONS_STYLESHEET);
        @unlink(MYBB_ROOT . "cache/themes/theme" . (int)$sheet['tid'] . "/" . str_replace('.css', '.min.css', REACTIONS_STYLESHEET));
    }

    $db->delete_query("themestylesheets", "name = '" . $db->escape_string(REACTIONS_STYLESHEET) . "'");

    update_theme_stylesheet_list(REACTIONS_MASTER_THEME, false, true);
}
