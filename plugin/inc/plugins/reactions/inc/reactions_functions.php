<?php
/**
 * MyBB Reactions Plugin - Core functions
 *
 * Reading the board's reactions, reading and writing members' reactions to posts, and
 * deciding who may do either.
 */

if(!defined("IN_MYBB"))
{
    die("Direct initialization of this file is not allowed.");
}

/**
 * Where uploaded reaction images are kept, with a trailing slash.
 *
 * @return string
 */
function reactions_upload_dir()
{
    return MYBB_ROOT . "uploads/reactions/";
}

/**
 * Rewrite the `reactions` datacache row from the table.
 *
 * Every reaction is cached, active or not, so a page view never queries the reactions
 * table: a post's summary needs the inactive ones too, to know which rows to leave out.
 * Called after every change the Admin CP makes.
 */
function reactions_rebuild_cache()
{
    global $db, $cache;

    $reactions = array();
    $query = $db->simple_select("reactions", "*", "", array('order_by' => 'disporder ASC, rid', 'order_dir' => 'ASC'));
    while($reaction = $db->fetch_array($query))
    {
        $reactions[(int)$reaction['rid']] = array(
            'rid'       => (int)$reaction['rid'],
            'name'      => $reaction['name'],
            'image'     => $reaction['image'],
            'disporder' => (int)$reaction['disporder'],
            'active'    => (int)$reaction['active'],
        );
    }

    $cache->update('reactions', $reactions);
}

/**
 * Every reaction on the board, in display order.
 *
 * @return array rid => reaction
 */
function reactions_all()
{
    global $cache;

    $reactions = $cache->read('reactions');
    if(!is_array($reactions))
    {
        reactions_rebuild_cache();
        $reactions = $cache->read('reactions', true);
    }

    return is_array($reactions) ? $reactions : array();
}

/**
 * The reactions members can currently pick, in display order.
 *
 * @return array rid => reaction
 */
function reactions_active()
{
    $active = array();
    foreach(reactions_all() as $rid => $reaction)
    {
        if($reaction['active'])
        {
            $active[$rid] = $reaction;
        }
    }

    return $active;
}

/**
 * The reaction a plain click on the React button applies: the first active one, which
 * on a new board is Like.
 *
 * @return array|null
 */
function reactions_default()
{
    $active = reactions_active();

    return $active ? reset($active) : null;
}

/**
 * The URL of a reaction's image.
 *
 * @param string $image A path relative to the forum root.
 * @return string
 */
function reactions_image_url($image)
{
    global $mybb;

    return $mybb->get_asset_url($image);
}

/**
 * An absolute link to a post, for somewhere other than an HTML attribute: a Location
 * header, or a [url] in a PM. get_post_link() escapes its ampersands for HTML, and
 * neither of those wants them escaped.
 *
 * @param int $pid
 * @param int $tid
 * @return string
 */
function reactions_post_url($pid, $tid)
{
    global $mybb;

    return rtrim($mybb->settings['bburl'], '/') . '/' . str_replace('&amp;', '&', get_post_link((int)$pid, (int)$tid)) . '#pid' . (int)$pid;
}

/**
 * Whether the member viewing the page may react to anything at all: anyone logged in.
 *
 * Nothing more is asked of them here. Whether they may react to a particular post is
 * whether they may see it (reactions_get_viewable_post()), which is what keeps banned
 * members out - MyBB's Banned group cannot view the board.
 *
 * @return bool
 */
function reactions_viewer_can_react()
{
    global $mybb;

    return $mybb->user['uid'] > 0;
}

/**
 * Look a post up and check the viewer may see it, which is what reacting to it, and
 * seeing who else has, both require.
 *
 * Mirrors what showthread.php checks before showing a post: the post and its thread are
 * visible (a moderator may see a deleted post, but not react to it), the forum is a real
 * one the viewer may view threads in, and its password, if it has one, has been given.
 *
 * @param int $pid
 * @return array|string The post, with its thread and forum under 'thread' and 'forum'; or
 *                      the language key of the reason not.
 */
function reactions_get_viewable_post($pid)
{
    global $mybb;

    $post = get_post((int)$pid);
    if(!$post || (int)$post['visible'] !== 1)
    {
        return 'reactions_error_invalid_post';
    }

    $thread = get_thread($post['tid']);
    if(!$thread || (int)$thread['visible'] !== 1)
    {
        return 'reactions_error_invalid_post';
    }

    $forum = get_forum($thread['fid']);
    if(!$forum || $forum['type'] != 'f' || (int)$forum['active'] !== 1)
    {
        return 'reactions_error_invalid_post';
    }

    $permissions = forum_permissions($forum['fid']);
    if(empty($permissions['canview']) || empty($permissions['canviewthreads']))
    {
        return 'reactions_error_no_permission';
    }
    if(!empty($permissions['canonlyviewownthreads']) && $thread['uid'] != $mybb->user['uid'])
    {
        return 'reactions_error_no_permission';
    }

    // Checked quietly: check_forum_password() would answer with the password form, which
    // is no answer to a fetch() from the reactions bar.
    if(!forum_password_validated($forum, true, true))
    {
        return 'reactions_error_no_permission';
    }

    $post['thread'] = $thread;
    $post['forum'] = $forum;

    return $post;
}

/**
 * Members' reactions to a set of posts, loaded once per page.
 *
 * Kept per request so the postbit hook, which runs once per post, costs two queries per
 * page rather than two per post. Rows for reactions that have since been deactivated are
 * left out: those reactions are hidden until an administrator brings them back.
 *
 * @param array $pids
 */
function reactions_preload(array $pids)
{
    global $db, $mybb, $reactions_post_cache;

    if(!is_array($reactions_post_cache))
    {
        $reactions_post_cache = array();
    }

    $pids = array_unique(array_filter(array_map('intval', $pids)));
    $missing = array();
    foreach($pids as $pid)
    {
        if(!isset($reactions_post_cache[$pid]))
        {
            $missing[] = $pid;
            $reactions_post_cache[$pid] = array('counts' => array(), 'total' => 0, 'mine' => 0);
        }
    }

    if(!$missing)
    {
        return;
    }

    $active = reactions_active();
    $pid_list = implode(',', $missing);

    $query = $db->query("
        SELECT pid, rid, COUNT(*) AS total
        FROM " . TABLE_PREFIX . "reactions_post
        WHERE pid IN ({$pid_list})
        GROUP BY pid, rid
    ");
    while($row = $db->fetch_array($query))
    {
        $pid = (int)$row['pid'];
        $rid = (int)$row['rid'];
        if(!isset($active[$rid]))
        {
            continue;
        }
        $reactions_post_cache[$pid]['counts'][$rid] = (int)$row['total'];
        $reactions_post_cache[$pid]['total'] += (int)$row['total'];
    }

    if($mybb->user['uid'] > 0)
    {
        $query = $db->simple_select("reactions_post", "pid, rid", "uid = " . (int)$mybb->user['uid'] . " AND pid IN ({$pid_list})");
        while($row = $db->fetch_array($query))
        {
            if(isset($active[(int)$row['rid']]))
            {
                $reactions_post_cache[(int)$row['pid']]['mine'] = (int)$row['rid'];
            }
        }
    }
}

/**
 * One post's reactions: the count of each, the total, and the viewer's own.
 *
 * @param int $pid
 * @return array
 */
function reactions_for_post($pid)
{
    global $reactions_post_cache;

    $pid = (int)$pid;
    if(!isset($reactions_post_cache[$pid]))
    {
        reactions_preload(array($pid));
    }

    return $reactions_post_cache[$pid];
}

/**
 * Forget what reactions_preload() loaded for a post, so the next read sees a change made
 * since.
 *
 * @param int $pid
 */
function reactions_forget_post($pid)
{
    global $reactions_post_cache;

    unset($reactions_post_cache[(int)$pid]);
}

/**
 * React to a post, switch reaction, or take a reaction back.
 *
 * Picking the reaction a member already has takes it back, as does $rid 0, so the same
 * button both adds a reaction and removes it - the way Facebook's does.
 *
 * Held under a named lock for the member and post: two clicks in quick succession (a
 * double click, or the picker and the button together) each read the row before either
 * writes, and MyISAM has no transaction to settle it. The unique key would turn the
 * second insert into an SQL error; the lock turns it into a switch.
 *
 * @param array $post The post, as reactions_get_viewable_post() returns it.
 * @param int $rid An active reaction's id, or 0 to take the member's reaction back.
 * @return array 'result' => added|switched|removed, 'rid' => the reaction now held (0 for none),
 *               'previous' => the reaction held before (0 for none)
 */
function reactions_react(array $post, $rid)
{
    global $db, $mybb;

    $pid = (int)$post['pid'];
    $uid = (int)$mybb->user['uid'];
    $rid = (int)$rid;

    $lock = $db->escape_string("reactions_{$pid}_{$uid}");
    $db->query("SELECT GET_LOCK('{$lock}', 10)");

    $existing = $db->fetch_array($db->simple_select("reactions_post", "id, rid", "pid = {$pid} AND uid = {$uid}"));
    $previous = $existing ? (int)$existing['rid'] : 0;

    if($rid === 0 || $rid === $previous)
    {
        if($existing)
        {
            $db->delete_query("reactions_post", "id = " . (int)$existing['id']);
        }
        $result = array('result' => 'removed', 'rid' => 0, 'previous' => $previous);
    }
    elseif($existing)
    {
        $db->update_query("reactions_post", array('rid' => $rid, 'dateline' => TIME_NOW), "id = " . (int)$existing['id']);
        $result = array('result' => 'switched', 'rid' => $rid, 'previous' => $previous);
    }
    else
    {
        $db->insert_query("reactions_post", array(
            'pid'      => $pid,
            'uid'      => $uid,
            'rid'      => $rid,
            'dateline' => TIME_NOW,
        ));
        $result = array('result' => 'added', 'rid' => $rid, 'previous' => 0);
    }

    $db->query("SELECT RELEASE_LOCK('{$lock}')");

    reactions_forget_post($pid);

    return $result;
}

/**
 * Remove the reactions to posts that no longer exist, out of a set of post ids.
 *
 * Checked against the posts table rather than taken on trust, so it can be handed every
 * post a merge touched - the one the others were merged into is still there, and keeps
 * its own reactions.
 *
 * @param array $pids
 */
function reactions_delete_orphans(array $pids)
{
    global $db;

    $pids = array_unique(array_filter(array_map('intval', $pids)));
    if(!$pids)
    {
        return;
    }

    $existing = array();
    $query = $db->simple_select("posts", "pid", "pid IN (" . implode(',', $pids) . ")");
    while($pid = $db->fetch_field($query, 'pid'))
    {
        $existing[] = (int)$pid;
    }

    $gone = array_diff($pids, $existing);
    if(!$gone)
    {
        return;
    }

    $in = implode(',', $gone);
    $db->delete_query("reactions_post", "pid IN ({$in})");
    $db->delete_query("reactions_notified", "pid IN ({$in})");
}
