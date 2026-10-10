<?php
/**
 * MyBB Reactions Plugin - Telling authors about reactions
 */

if(!defined("IN_MYBB"))
{
    die("Direct initialization of this file is not allowed.");
}

require_once MYBB_ROOT . "inc/plugins/reactions/inc/reactions_functions.php";

/**
 * Send a post's author a PM about a reaction, if they should hear about this one.
 *
 * Only ever once per member per post. Switching from Like to Love, or taking a reaction
 * back and adding it again, is the same member having the same thought about the same
 * post, and an author who heard about it the first time does not need to again - so the
 * pair is recorded the first time and never notified twice, whatever the reaction.
 *
 * Nobody is told about their own reaction, nobody who has turned these off in their User
 * CP options, and nobody at all when the board has turned them off.
 *
 * The PM is from the member who reacted, the way a PM from them would be, so the author
 * can answer it - but no copy goes into the reacting member's Sent Items: they did not
 * write it.
 *
 * @param array $post The post, as reactions_get_viewable_post() returns it.
 * @param array $reaction The reaction just added.
 * @return bool Whether a PM was sent.
 */
function reactions_notify_author(array $post, array $reaction)
{
    global $db, $mybb, $lang;

    $author_uid = (int)$post['uid'];
    $reactor_uid = (int)$mybb->user['uid'];

    if(empty($mybb->settings['reactions_notify_pm']) || $author_uid < 1 || $author_uid === $reactor_uid)
    {
        return false;
    }

    $pid = (int)$post['pid'];

    // Claimed before anything is sent, with INSERT IGNORE settling it: two requests racing
    // to notify for the same pair both try the insert, and only one of them gets a row.
    $db->write_query("INSERT IGNORE INTO " . TABLE_PREFIX . "reactions_notified (pid, uid) VALUES ({$pid}, {$reactor_uid})");
    if($db->affected_rows() < 1)
    {
        return false;
    }

    $author = get_user($author_uid);
    if(!$author || empty($author['reactions_notify']) || !reactions_author_accepts_pm($author, $reactor_uid))
    {
        return false;
    }

    // In the author's language rather than the reacting member's: it is the author who
    // reads it.
    $author_lang = $lang;
    if(!empty($author['language']) && $author['language'] != $lang->language && $lang->language_exists($author['language']))
    {
        $author_lang = new MyLanguage;
        $author_lang->set_path(MYBB_ROOT . "inc/languages");
        $author_lang->set_language($author['language']);
        $author_lang->load('reactions');
    }

    $bburl = rtrim($mybb->settings['bburl'], '/');
    $subject = $author_lang->sprintf($author_lang->reactions_pm_subject, $mybb->user['username']);
    $message = $author_lang->sprintf(
        $author_lang->reactions_pm_message,
        $mybb->user['username'],
        $reaction['name'],
        $bburl . '/' . str_replace('&amp;', '&', get_profile_link($reactor_uid)),
        $post['thread']['subject'],
        reactions_post_url($pid, $post['tid']),
        $bburl . '/usercp.php?action=options'
    );

    require_once MYBB_ROOT . "inc/datahandlers/pm.php";

    $pmhandler = new PMDataHandler();
    // Past the sender's flood limit and both quotas: a member reacting to a page of posts
    // sends a PM per post inside a minute, and the flood check would quietly drop all but
    // the first - after reactions_notified had already recorded them as sent. The checks
    // that are the author's own say, the ones admin override would also skip, are made
    // above by reactions_author_accepts_pm() instead.
    $pmhandler->admin_override = true;
    $pmhandler->set_data(array(
        'subject'   => $subject,
        'message'   => $message,
        'icon'      => 0,
        // insert_pm() records the sender's address and, on PHP 8, warns when it is missing.
        'ipaddress' => my_inet_pton(get_ip()),
        'fromid'    => $reactor_uid,
        'toid'      => array($author_uid),
        'do'        => '',
        'pmid'      => '',
        'options'   => array(
            'signature'      => 0,
            'disablesmilies' => 0,
            'savecopy'       => 0,
            'readreceipt'    => 0,
        ),
    ));

    if(!$pmhandler->validate_pm())
    {
        return false;
    }

    $pmhandler->insert_pm();

    return true;
}

/**
 * Whether an author would take a PM from a member, by the author's own settings: PMs on
 * and allowed for their group, the member not on their ignore list, and - where the board
 * lets members take PMs from buddies only and the author does - the member a buddy.
 *
 * The same checks PMDataHandler::verify_recipient() makes, which admin override skips.
 *
 * @param array $author
 * @param int $sender_uid
 * @return bool
 */
function reactions_author_accepts_pm(array $author, $sender_uid)
{
    global $mybb;

    $permissions = user_permissions($author['uid']);
    if(empty($author['receivepms']) || empty($permissions['canusepms']))
    {
        return false;
    }

    $needle = ',' . (int)$sender_uid . ',';
    if(!empty($author['ignorelist']) && strpos(',' . $author['ignorelist'] . ',', $needle) !== false)
    {
        return false;
    }

    if(!empty($mybb->settings['allowbuddyonly']) && !empty($author['receivefrombuddy'])
        && strpos(',' . $author['buddylist'] . ',', $needle) === false)
    {
        return false;
    }

    return true;
}
