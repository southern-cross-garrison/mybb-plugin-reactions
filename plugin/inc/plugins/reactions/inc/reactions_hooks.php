<?php
/**
 * MyBB Reactions Plugin - Hooks
 *
 * The only one of the plugin's files loaded on every request, so it holds the hook
 * functions themselves and pulls the rest in only when a hook actually needs it.
 */

if(!defined("IN_MYBB"))
{
    die("Direct initialization of this file is not allowed.");
}

/**
 * Register the front-end hooks, and fetch the plugin's templates with the page's own.
 */
function reactions_register_hooks()
{
    global $plugins, $templatelist, $mybb;

    $plugins->add_hook("showthread_start", "reactions_showthread_start");
    $plugins->add_hook("postbit", "reactions_postbit");

    // Every other kind of postbit renders the same templates, and so the same
    // {$post['reactions']} - which on PHP 8 is a logged warning wherever it is undefined.
    $plugins->add_hook("postbit_prev", "reactions_postbit_empty");
    $plugins->add_hook("postbit_pm", "reactions_postbit_empty");
    $plugins->add_hook("postbit_announcement", "reactions_postbit_empty");

    $plugins->add_hook("misc_start", "reactions_misc_start");

    $plugins->add_hook("usercp_options_start", "reactions_usercp_options_start");
    $plugins->add_hook("usercp_do_options_end", "reactions_usercp_do_options_end");

    // Fetched in the same query as the page's own templates rather than one at a time.
    // Plugins are loaded before global.php caches the page's templates, so this is early
    // enough. newreply.php is there for quick reply, which answers with a postbit.
    if(!defined('THIS_SCRIPT'))
    {
        return;
    }

    $bar = 'reactions_postbit,reactions_controls,reactions_picker_item,reactions_summary,reactions_summary_icon';
    $who = 'reactions_who,reactions_who_tab,reactions_who_row,reactions_who_empty,reactions_who_modal,reactions_who_page';

    if(THIS_SCRIPT === 'showthread.php' || THIS_SCRIPT === 'newreply.php')
    {
        $templatelist .= ($templatelist ? ',' : '') . $bar;
    }
    elseif(THIS_SCRIPT === 'misc.php' && isset($mybb->input['action']) && $mybb->input['action'] === 'reactions_who')
    {
        $templatelist .= ($templatelist ? ',' : '') . $who;
    }
    elseif(THIS_SCRIPT === 'misc.php' && isset($mybb->input['action']) && $mybb->input['action'] === 'reactions_react')
    {
        $templatelist .= ($templatelist ? ',' : '') . $bar;
    }
    elseif(THIS_SCRIPT === 'usercp.php')
    {
        $templatelist .= ($templatelist ? ',' : '') . 'reactions_usercp_option,reactions_usercp_option_row';
    }
}

/**
 * Load the plugin's front-end language strings, once.
 */
function reactions_load_language()
{
    global $lang;

    if(!isset($lang->reactions_react))
    {
        $lang->load('reactions');
    }
}

// ---------------------------------------------------------------------------
// Threads
// ---------------------------------------------------------------------------

/**
 * Add the reactions script to the thread's <head>.
 *
 * Hooks: showthread_start
 */
function reactions_showthread_start()
{
    global $headerinclude, $mybb;

    $info = reactions_info();
    $src = $mybb->get_asset_url('jscripts/reactions/reactions.js') . '?ver=' . urlencode($info['version']);
    $headerinclude .= "\n<script type=\"text/javascript\" src=\"" . htmlspecialchars_uni($src) . "\" defer></script>";
}

/**
 * Put the reactions bar on a post.
 *
 * The first post on a page loads the reactions for every post on it: showthread.php has
 * worked out which posts those are by then, in $pids, so a page of posts costs two
 * queries rather than two each. Where it has not - threaded mode, or the single post quick
 * reply sends back - each post loads its own.
 *
 * Hooks: postbit
 *
 * @param array $post
 * @return array
 */
function reactions_postbit(&$post)
{
    global $pids, $reactions_preloaded;

    require_once MYBB_ROOT . "inc/plugins/reactions/inc/reactions_render.php";
    reactions_load_language();

    if(empty($reactions_preloaded) && THIS_SCRIPT === 'showthread.php' && is_string($pids)
        && preg_match_all('#\d+#', $pids, $matches))
    {
        reactions_preload($matches[0]);
        $reactions_preloaded = true;
    }

    // Unapproved and soft-deleted posts are shown to moderators, but are not there to be
    // reacted to. Anything else on the page the viewer can see, so can react to.
    $can_react = reactions_viewer_can_react() && (!isset($post['visible']) || (int)$post['visible'] === 1);

    $post['reactions'] = reactions_render_bar($post, $can_react);

    return $post;
}

/**
 * Leave {$post['reactions']} empty on postbits that are not posts in a thread.
 *
 * Hooks: postbit_prev, postbit_pm, postbit_announcement
 *
 * @param array $post
 * @return array
 */
function reactions_postbit_empty(&$post)
{
    $post['reactions'] = '';

    return $post;
}

// ---------------------------------------------------------------------------
// misc.php: reacting, and seeing who reacted
// ---------------------------------------------------------------------------

/**
 * Hooks: misc_start
 */
function reactions_misc_start()
{
    global $mybb;

    $action = $mybb->get_input('action');
    if($action === 'reactions_react')
    {
        reactions_misc_react();
    }
    elseif($action === 'reactions_who')
    {
        reactions_misc_who();
    }
}

/**
 * Turn a request down: as JSON for the reactions bar's script, as MyBB's error page for a
 * form posted without one.
 *
 * @param string $message
 * @param int $status
 * @param bool $ajax
 */
function reactions_fail($message, $status, $ajax)
{
    if($ajax)
    {
        reactions_send_json(array('error' => $message), $status);
    }

    error($message);
}

/**
 * Answer the reactions bar's script and stop.
 *
 * @param array $data
 * @param int $status
 */
function reactions_send_json(array $data, $status = 200)
{
    global $charset;

    http_response_code($status);
    header("Content-type: application/json; charset={$charset}");
    header("Cache-Control: no-store");
    echo json_encode($data);
    exit;
}

/**
 * React to a post, switch reaction, or take a reaction back.
 *
 * Posted by the React button and the picker. The script sends ajax=1 and gets the post's
 * redrawn bar back; without a script the same form posts normally and lands back on the
 * post.
 */
function reactions_misc_react()
{
    global $mybb, $lang;

    require_once MYBB_ROOT . "inc/plugins/reactions/inc/reactions_render.php";
    reactions_load_language();

    $ajax = $mybb->get_input('ajax', MyBB::INPUT_INT) === 1;

    if($mybb->request_method !== 'post')
    {
        reactions_fail($lang->reactions_error_generic, 405, $ajax);
    }

    if(!verify_post_check($mybb->get_input('my_post_key'), true))
    {
        reactions_fail($lang->invalid_post_code, 403, $ajax);
    }

    if(empty($mybb->user['uid']))
    {
        if(!$ajax)
        {
            error_no_permission();
        }
        reactions_fail($lang->reactions_error_guest, 401, true);
    }

    $post = reactions_get_viewable_post($mybb->get_input('pid', MyBB::INPUT_INT));
    if(!is_array($post))
    {
        reactions_fail($lang->$post, $post === 'reactions_error_no_permission' ? 403 : 404, $ajax);
    }

    $rid = $mybb->get_input('rid', MyBB::INPUT_INT);
    $active = reactions_active();
    if($rid !== 0 && !isset($active[$rid]))
    {
        reactions_fail($lang->reactions_error_invalid_reaction, 400, $ajax);
    }

    $result = reactions_react($post, $rid);

    if($result['result'] === 'added')
    {
        require_once MYBB_ROOT . "inc/plugins/reactions/inc/reactions_notify.php";
        reactions_notify_author($post, $active[$rid]);
    }

    if($ajax)
    {
        reactions_send_json(array(
            'result' => $result['result'],
            'rid'    => $result['rid'],
            'html'   => reactions_render_bar($post, true),
        ));
    }

    // Straight back to the post, without MyBB's "thank you, redirecting" page in between:
    // the change is on the post itself, which is where the member is going.
    header("Location: " . reactions_post_url($post['pid'], $post['tid']), true, 303);
    exit;
}

/**
 * Who reacted to a post: a popup over the thread when asked for with modal=1 (as MyBB's
 * own "who posted" is), otherwise a page of its own.
 */
function reactions_misc_who()
{
    global $mybb, $lang, $templates, $headerinclude, $header, $footer, $theme;

    require_once MYBB_ROOT . "inc/plugins/reactions/inc/reactions_render.php";
    reactions_load_language();

    $post = reactions_get_viewable_post($mybb->get_input('pid', MyBB::INPUT_INT));
    if(!is_array($post))
    {
        if($post === 'reactions_error_no_permission')
        {
            error_no_permission();
        }
        error($lang->$post);
    }

    $rid = $mybb->get_input('rid', MyBB::INPUT_INT);
    $active = reactions_active();
    if(!isset($active[$rid]))
    {
        $rid = 0;
    }

    $title = $lang->sprintf($lang->reactions_who_title_post, htmlspecialchars_uni($post['username']));
    $post_link = htmlspecialchars_uni(reactions_post_url($post['pid'], $post['tid']));

    if($mybb->get_input('modal', MyBB::INPUT_INT) === 1)
    {
        $who = reactions_render_who($post);
        eval("\$modal = \"" . $templates->get("reactions_who_modal", 1, 0) . "\";");
        echo $modal;
        exit;
    }

    $who = reactions_render_who($post, $rid);

    build_forum_breadcrumb($post['forum']['fid']);
    add_breadcrumb(htmlspecialchars_uni($post['thread']['subject']), get_thread_link($post['tid']));
    add_breadcrumb($lang->reactions_who_title);

    eval("\$page = \"" . $templates->get("reactions_who_page") . "\";");
    output_page($page);
    exit;
}

// ---------------------------------------------------------------------------
// User CP: the notification opt-out
// ---------------------------------------------------------------------------

/**
 * Build the "PM me about reactions" checkbox for the User CP options page.
 *
 * It goes at the end of the private messaging options, which MyBB's own templates lay
 * out as table rows and the garrison theme as Bootstrap form checks. Neither markup
 * survives inside the other - a <div> in a table is pushed out of it by the browser - so
 * there is one template for each, and the one used is whichever matches the board's own
 * usercp_options_pms.
 *
 * Hooks: usercp_options_start
 */
function reactions_usercp_options_start()
{
    global $mybb, $lang, $templates, $reactions_usercp_option;

    reactions_load_language();

    $reactions_notify_checked = !empty($mybb->user['reactions_notify']) ? ' checked="checked"' : '';

    $template = stripos($templates->get("usercp_options_pms"), '<tr') !== false
        ? "reactions_usercp_option_row"
        : "reactions_usercp_option";

    eval("\$reactions_usercp_option = \"" . $templates->get($template, 1, 0) . "\";");
}

/**
 * Save the "PM me about reactions" checkbox.
 *
 * Only when the form had it: a member whose group cannot use PMs is not shown the PM
 * options at all, and an unchecked box and a missing one post the same nothing.
 *
 * Hooks: usercp_do_options_end
 */
function reactions_usercp_do_options_end()
{
    global $db, $mybb;

    if($mybb->get_input('reactions_notify_shown', MyBB::INPUT_INT) !== 1)
    {
        return;
    }

    $db->update_query("users",
        array('reactions_notify' => $mybb->get_input('reactions_notify', MyBB::INPUT_INT) ? 1 : 0),
        "uid = " . (int)$mybb->user['uid']);
}

// ---------------------------------------------------------------------------
// Content going away
// ---------------------------------------------------------------------------

/**
 * Hooks: class_moderation_delete_post
 *
 * @param int $pid
 */
function reactions_post_deleted($pid)
{
    require_once MYBB_ROOT . "inc/plugins/reactions/inc/reactions_functions.php";

    reactions_delete_orphans(array($pid));
}

/**
 * Note a thread's posts before it is deleted: by the time the delete has finished, there
 * is nothing left to say which posts were in it.
 *
 * Hooks: class_moderation_delete_thread_start
 *
 * @param int $tid
 */
function reactions_thread_deleting($tid)
{
    global $db, $reactions_deleting_threads;

    if(!is_array($reactions_deleting_threads))
    {
        $reactions_deleting_threads = array();
    }

    $pids = array();
    $query = $db->simple_select("posts", "pid", "tid = " . (int)$tid);
    while($pid = $db->fetch_field($query, 'pid'))
    {
        $pids[] = (int)$pid;
    }

    $reactions_deleting_threads[(int)$tid] = $pids;
}

/**
 * Hooks: class_moderation_delete_thread
 *
 * @param int $tid
 */
function reactions_thread_deleted($tid)
{
    global $reactions_deleting_threads;

    require_once MYBB_ROOT . "inc/plugins/reactions/inc/reactions_functions.php";

    if(!empty($reactions_deleting_threads[(int)$tid]))
    {
        reactions_delete_orphans($reactions_deleting_threads[(int)$tid]);
    }
    unset($reactions_deleting_threads[(int)$tid]);
}

/**
 * Merging posts keeps the first and deletes the rest. The one kept keeps its own
 * reactions; the others' go with them.
 *
 * Hooks: class_moderation_merge_posts
 *
 * @param array $arguments 'pids' => the posts merged, 'tid' => their thread
 */
function reactions_posts_merged($arguments)
{
    require_once MYBB_ROOT . "inc/plugins/reactions/inc/reactions_functions.php";

    if(!empty($arguments['pids']))
    {
        reactions_delete_orphans((array)$arguments['pids']);
    }
}

/**
 * A deleted member's reactions go with them. Their posts, and the reactions to those, go
 * through the post and thread hooks above if their posts are deleted too.
 *
 * Hooks: datahandler_user_delete_content
 *
 * @param UserDataHandler $handler
 */
function reactions_users_deleted($handler)
{
    global $db;

    if(empty($handler->delete_uids))
    {
        return;
    }

    $uids = implode(',', array_filter(array_map('intval', explode(',', (string)$handler->delete_uids))));
    if($uids === '')
    {
        return;
    }

    $db->delete_query("reactions_post", "uid IN ({$uids})");
    $db->delete_query("reactions_notified", "uid IN ({$uids})");
}

// ---------------------------------------------------------------------------
// Admin CP
// ---------------------------------------------------------------------------

/**
 * Hooks: admin_config_menu
 *
 * @param array $sub_menu
 * @return array
 */
function reactions_admin_config_menu(&$sub_menu)
{
    global $lang;

    $lang->load('config_reactions', false, true);

    $sub_menu[] = array(
        'id'    => 'reactions',
        'title' => $lang->reactions,
        'link'  => 'index.php?module=config-reactions'
    );

    return $sub_menu;
}

/**
 * Hooks: admin_config_action_handler
 *
 * @param array $actions
 * @return array
 */
function reactions_admin_config_action_handler(&$actions)
{
    $actions['reactions'] = array('active' => 'reactions', 'file' => 'reactions.php');

    return $actions;
}

/**
 * Word the plugin's entries in the administrator log. MyBB looks the wording up as
 * admin_log_<module>_<action>, which is in the plugin's own Admin CP language file.
 *
 * Hooks: admin_tools_get_admin_log_action
 *
 * @param array $args
 */
function reactions_admin_log_action(&$args)
{
    global $lang;

    if($args['logitem']['module'] === 'config-reactions')
    {
        $lang->load('config_reactions', false, true);
    }
}
