<?php
/**
 * MyBB Reactions Plugin - Templates
 *
 * The plugin's templates live as .html files under reactions/templates/ so they can be
 * edited in the repo, but MyBB renders templates out of the `templates` table. These
 * helpers sync the files into the master template set (sid = -2), which is what
 * $templates->get() falls back to when a theme has no override.
 *
 * The one thing a template file cannot do is put the plugin into MyBB's own pages: the
 * reactions bar into the post, the notification opt-out into the User CP. Those templates
 * belong to MyBB and to every theme on the board, so they are template edits, made on
 * activation and undone on deactivation.
 */

if(!defined("IN_MYBB"))
{
    die("Direct initialization of this file is not allowed.");
}

define('REACTIONS_TEMPLATE_PREFIX', 'reactions_');

/**
 * What the template edits add: the reactions bar to postbit and postbit_classic, and the
 * notification opt-out to the User CP's private messaging options.
 */
define('REACTIONS_POSTBIT_VARIABLE', "{\$post['reactions']}");
define('REACTIONS_USERCP_VARIABLE', "{\$reactions_usercp_option}");

/**
 * Read the plugin's template files from disk.
 *
 * @return array title => template body
 */
function reactions_get_template_files()
{
    $templates = array();
    $dir = MYBB_ROOT . "inc/plugins/reactions/templates/";

    foreach((array)glob($dir . "*.html") as $file)
    {
        $templates[basename($file, ".html")] = file_get_contents($file);
    }

    return $templates;
}

/**
 * Install (or refresh) the plugin's templates and their ACP template group.
 *
 * Safe to call repeatedly - existing master templates are replaced so that editing a
 * .html file and re-activating the plugin picks up the change.
 */
function reactions_install_templates()
{
    global $db, $mybb;

    $group = $db->fetch_array($db->simple_select("templategroups", "gid", "prefix = '" . REACTIONS_TEMPLATE_PREFIX . "'"));
    if(!$group)
    {
        $db->insert_query("templategroups", array(
            "prefix"    => REACTIONS_TEMPLATE_PREFIX,
            "title"     => "Reactions",
            "isdefault" => 0
        ));
    }

    foreach(reactions_get_template_files() as $title => $template)
    {
        $row = array(
            "title"    => $db->escape_string($title),
            "template" => $db->escape_string($template),
            "sid"      => -2,
            "version"  => $db->escape_string($mybb->version_code),
            "status"   => "",
            "dateline" => TIME_NOW
        );

        $existing = $db->fetch_array($db->simple_select("templates", "tid", "title = '" . $db->escape_string($title) . "' AND sid = -2"));
        if($existing)
        {
            $db->update_query("templates", $row, "tid = " . (int)$existing['tid']);
        }
        else
        {
            $db->insert_query("templates", $row);
        }
    }
}

/**
 * Remove the plugin's templates, including any theme-level customisations of them.
 */
function reactions_uninstall_templates()
{
    global $db;

    $titles = array_keys(reactions_get_template_files());
    if(!empty($titles))
    {
        $escaped = array();
        foreach($titles as $title)
        {
            $escaped[] = "'" . $db->escape_string($title) . "'";
        }
        $db->delete_query("templates", "title IN (" . implode(",", $escaped) . ")");
    }

    // Catch templates from older versions of the plugin that no longer ship a file.
    $db->delete_query("templates", "title LIKE '" . $db->escape_string(REACTIONS_TEMPLATE_PREFIX) . "%'");
    $db->delete_query("templategroups", "prefix = '" . REACTIONS_TEMPLATE_PREFIX . "'");
}

/**
 * Put the plugin into every theme's templates.
 *
 * The reactions bar goes at the foot of the post's content, under the IP address row:
 * straight after whichever of {$post['iplogged']} and {$post['input_editreason']} comes
 * last. Every postbit has both, in MyBB's own templates and in the garrison theme's alike,
 * but not in the same order - MyBB's puts the IP address in a row with the edit reason
 * after it, the garrison's puts it last - and the later of the two is the end of the
 * content in both. That is below the message rather than inside it, which matters: quick
 * edit replaces the message's container wholesale, and a bar inside it would be gone after
 * the first edit until the page was reloaded.
 *
 * The opt-out goes at the end of the PM options, whose last row differs from theme to
 * theme - so it is anchored to the end of the template rather than to any one of them.
 *
 * Removed first, so activating twice never leaves a post with two bars.
 */
function reactions_apply_template_edits()
{
    require_once MYBB_ROOT . "inc/adminfunctions_templates.php";

    reactions_revert_template_edits();

    $anchor = '(?:' . preg_quote("{\$post['iplogged']}", '#') . '|' . preg_quote("{\$post['input_editreason']}", '#') . ')';
    foreach(array('postbit', 'postbit_classic') as $title)
    {
        find_replace_templatesets(
            $title,
            '#(' . $anchor . ')(?!.*' . $anchor . ')#s',
            '${1}' . REACTIONS_POSTBIT_VARIABLE,
            1,
            false,
            1
        );
    }

    // Last among the PM options, after the ones MyBB ships.
    find_replace_templatesets('usercp_options_pms', '#\\z#', REACTIONS_USERCP_VARIABLE, 1, false, 1);
}

/**
 * Take the plugin back out of every theme's templates.
 */
function reactions_revert_template_edits()
{
    require_once MYBB_ROOT . "inc/adminfunctions_templates.php";

    foreach(array('postbit', 'postbit_classic') as $title)
    {
        find_replace_templatesets(
            $title,
            '#' . preg_quote(REACTIONS_POSTBIT_VARIABLE, '#') . '#',
            '',
            0
        );
    }

    find_replace_templatesets('usercp_options_pms', '#' . preg_quote(REACTIONS_USERCP_VARIABLE, '#') . '#', '', 0);
}
