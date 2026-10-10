<?php
/**
 * MyBB Reactions Plugin - Rendering
 *
 * Templates are eval'd strings with no logic of their own, so everything conditional or
 * repeated - which reactions to picture, the "You and 3 others" wording, the picker's
 * buttons - is decided here and handed to them as plain variables.
 */

if(!defined("IN_MYBB"))
{
    die("Direct initialization of this file is not allowed.");
}

require_once MYBB_ROOT . "inc/plugins/reactions/inc/reactions_functions.php";

/**
 * A reaction made safe to drop into a template: name escaped, image resolved to a URL.
 *
 * @param array $reaction
 * @return array
 */
function reactions_template_reaction(array $reaction)
{
    return array(
        'rid'       => (int)$reaction['rid'],
        'name'      => htmlspecialchars_uni($reaction['name']),
        'image_url' => htmlspecialchars_uni(reactions_image_url($reaction['image'])),
    );
}

/**
 * The reactions bar under a post: its summary, and the React button and picker for a
 * member who may react.
 *
 * A post nobody has reacted to, seen by somebody who cannot react, gets no bar at all -
 * there would be nothing in it.
 *
 * @param array $post A post row; only pid is read.
 * @param bool $can_react Whether the viewer may react to this post.
 * @return string
 */
function reactions_render_bar(array $post, $can_react)
{
    global $templates, $mybb, $lang;

    $pid = (int)$post['pid'];
    $data = reactions_for_post($pid);

    $controls = '';
    if($can_react)
    {
        $controls = reactions_render_controls($pid, $data);
    }

    // When the member's own reaction is the only one, the React button already shows it,
    // and a summary reading "You" beside it would say it twice. Without the button (an
    // unapproved post, seen by a moderator) the summary is the only place it shows, so it
    // stays.
    $summary = '';
    if($controls === '' || $data['total'] != 1 || !$data['mine'])
    {
        $summary = reactions_render_summary($pid, $data);
    }

    if($summary === '' && $controls === '')
    {
        return '';
    }

    eval("\$bar = \"" . $templates->get("reactions_postbit") . "\";");

    return $bar;
}

/**
 * The pictures of a post's most used reactions, and how many reactions there are.
 *
 * @param int $pid
 * @param array $data As reactions_for_post() returns it.
 * @return string
 */
function reactions_render_summary($pid, array $data)
{
    global $templates, $mybb, $lang;

    if($data['total'] < 1)
    {
        return '';
    }

    $all = reactions_all();

    // Most used first. A tie goes to the reaction that comes first in the picker, so two
    // posts with the same counts always show the same pictures in the same order.
    $counts = $data['counts'];
    uksort($counts, function($a, $b) use ($counts, $all)
    {
        if($counts[$a] != $counts[$b])
        {
            return $counts[$b] - $counts[$a];
        }
        if($all[$a]['disporder'] != $all[$b]['disporder'])
        {
            return $all[$a]['disporder'] - $all[$b]['disporder'];
        }
        return $a - $b;
    });

    $limit = max(1, (int)$mybb->settings['reactions_summary_icons']);
    $summary_icons = '';
    foreach(array_slice($counts, 0, $limit, true) as $rid => $count)
    {
        $icon = reactions_template_reaction($all[$rid]);
        $icon['count'] = my_number_format($count);
        eval("\$summary_icons .= \"" . $templates->get("reactions_summary_icon", 1, 0) . "\";");
    }

    $total = (int)$data['total'];
    if($data['mine'])
    {
        if($total == 1)
        {
            $summary_text = $lang->reactions_summary_you;
        }
        elseif($total == 2)
        {
            $summary_text = $lang->reactions_summary_you_and_one;
        }
        else
        {
            $summary_text = $lang->sprintf($lang->reactions_summary_you_and_others, my_number_format($total - 1));
        }
    }
    else
    {
        $summary_text = my_number_format($total);
    }

    $summary_label = $total == 1
        ? $lang->reactions_summary_label_one
        : $lang->sprintf($lang->reactions_summary_label, my_number_format($total));

    eval("\$summary = \"" . $templates->get("reactions_summary", 1, 0) . "\";");

    return $summary;
}

/**
 * The React button and the picker behind it.
 *
 * The button shows the reaction the member has, or the default one (Like) when they have
 * none - and either way its value is that reaction, so submitting it with no script
 * running does what clicking it does with one: adds Like, or takes the member's reaction
 * back. Each picker item submits its own reaction the same way.
 *
 * @param int $pid
 * @param array $data As reactions_for_post() returns it.
 * @return string
 */
function reactions_render_controls($pid, array $data)
{
    global $templates, $mybb, $lang;

    $active = reactions_active();
    if(!$active)
    {
        return '';
    }

    $mine = $data['mine'] && isset($active[$data['mine']]) ? $active[$data['mine']] : null;
    $shown = $mine ? $mine : reactions_default();

    $button_rid = (int)$shown['rid'];
    $button_image = htmlspecialchars_uni(reactions_image_url($shown['image']));
    $button_label = $mine ? htmlspecialchars_uni($mine['name']) : htmlspecialchars_uni($shown['name']);
    $button_pressed = $mine ? 'true' : 'false';
    $button_class = $mine ? ' reactions-button--active' : '';

    $picker_items = '';
    foreach($active as $rid => $raw)
    {
        $reaction = reactions_template_reaction($raw);
        $selected = $mine && (int)$mine['rid'] === (int)$rid;
        $item_class = $selected ? ' reactions-picker-item--active' : '';
        $item_pressed = $selected ? 'true' : 'false';
        eval("\$picker_items .= \"" . $templates->get("reactions_picker_item", 1, 0) . "\";");
    }

    eval("\$controls = \"" . $templates->get("reactions_controls", 1, 0) . "\";");

    return $controls;
}

/**
 * Who reacted to a post, as tabs - everybody, then one per reaction used - over a list of
 * members.
 *
 * Every row is listed whichever tab is current, each carrying its reaction, so the popup
 * can switch tabs without asking the server again. The page version, which has no script
 * to lean on, is handed the reaction to filter by instead.
 *
 * @param array $post
 * @param int $filter_rid A reaction to list only that one's members; 0 for everybody.
 * @return string
 */
function reactions_render_who(array $post, $filter_rid = 0)
{
    global $db, $templates, $mybb, $lang;

    $pid = (int)$post['pid'];
    $active = reactions_active();

    // Newest first, as Facebook lists them.
    $members = array();
    $counts = array();
    $query = $db->query("
        SELECT r.rid, r.uid, u.username, u.usergroup, u.displaygroup, u.avatar, u.avatardimensions
        FROM " . TABLE_PREFIX . "reactions_post r
        INNER JOIN " . TABLE_PREFIX . "users u ON (u.uid = r.uid)
        WHERE r.pid = {$pid}
        ORDER BY r.dateline DESC, r.id DESC
    ");
    while($row = $db->fetch_array($query))
    {
        $rid = (int)$row['rid'];
        if(!isset($active[$rid]))
        {
            continue;
        }
        $members[] = $row;
        $counts[$rid] = isset($counts[$rid]) ? $counts[$rid] + 1 : 1;
    }

    $base_url = "misc.php?action=reactions_who&amp;pid={$pid}";

    $tabs = '';
    $tab = array(
        'url'      => $base_url,
        'class'    => $filter_rid ? '' : ' reactions-who-tab--active',
        'rid'      => 0,
        'selected' => $filter_rid ? 'false' : 'true',
        'icon'     => '',
        'label'    => $lang->reactions_who_all,
        'count'    => my_number_format(count($members)),
    );
    eval("\$tabs .= \"" . $templates->get("reactions_who_tab", 1, 0) . "\";");

    // In the picker's order, like the summary's tie-break, rather than by count: the tabs
    // would otherwise shuffle every time somebody reacted.
    foreach($active as $rid => $raw)
    {
        if(empty($counts[$rid]))
        {
            continue;
        }
        $reaction = reactions_template_reaction($raw);
        $selected = (int)$filter_rid === (int)$rid;
        $tab = array(
            'url'      => "{$base_url}&amp;rid={$rid}",
            'class'    => $selected ? ' reactions-who-tab--active' : '',
            'rid'      => (int)$rid,
            'selected' => $selected ? 'true' : 'false',
            'icon'     => "<img src=\"{$reaction['image_url']}\" alt=\"\" class=\"reactions-icon\" />",
            'label'    => $reaction['name'],
            'count'    => my_number_format($counts[$rid]),
        );
        eval("\$tabs .= \"" . $templates->get("reactions_who_tab", 1, 0) . "\";");
    }

    // A member who has turned avatars off in the User CP sees the default one for
    // everybody, as the postbit does.
    $show_avatars = empty($mybb->user['uid']) || !empty($mybb->user['showavatars']);

    $rows = '';
    foreach($members as $member)
    {
        if($filter_rid && (int)$member['rid'] !== (int)$filter_rid)
        {
            continue;
        }
        $reaction = reactions_template_reaction($active[(int)$member['rid']]);
        $avatar = $show_avatars
            ? format_avatar($member['avatar'], $member['avatardimensions'])
            : format_avatar('');
        $row = array(
            'rid'         => (int)$member['rid'],
            'reaction'    => $reaction['name'],
            'image_url'   => $reaction['image_url'],
            'avatar'      => $avatar['image'],
            'profilelink' => build_profile_link(
                format_name(htmlspecialchars_uni($member['username']), $member['usergroup'], $member['displaygroup']),
                $member['uid']
            ),
        );
        eval("\$rows .= \"" . $templates->get("reactions_who_row", 1, 0) . "\";");
    }

    if($rows === '')
    {
        eval("\$rows = \"" . $templates->get("reactions_who_empty", 1, 0) . "\";");
    }

    eval("\$who = \"" . $templates->get("reactions_who", 1, 0) . "\";");

    return $who;
}
