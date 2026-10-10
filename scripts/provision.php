<?php
/**
 * Provisions the MyBB test forum with everything the Reactions plugin e2e suite needs:
 * fixture users, a forum most of them cannot see, threads to react to, and the plugin
 * itself (installed and activated through MyBB's real plugin code path).
 *
 * Run inside the web container:  docker compose exec -T web php /dev/stdin < scripts/provision.php
 * Idempotent: safe to run repeatedly.
 */

define('IN_MYBB', 1);
define('MYBB_ROOT', '/var/www/html/');
define('THIS_SCRIPT', 'provision.php');
define('NO_ONLINE', 1);

require_once MYBB_ROOT . 'inc/init.php';

// Surface the failing query when something goes wrong during provisioning.
$mybb->dev_mode = 1;
// Loaded as global.php does. UserDataHandler's timezone check reads the timezone names
// from it, and on PHP 8 each one missing is a logged warning rather than a silent notice.
$lang->set_language($mybb->settings['bblanguage']);
$lang->load('global');
require_once MYBB_ROOT . 'inc/functions_user.php';
require_once MYBB_ROOT . 'inc/datahandlers/user.php';
require_once MYBB_ROOT . 'inc/datahandlers/post.php';

/** @var DB_MySQLi $db */
/** @var MyBB $mybb */
/** @var datacache $cache */
/** @var pluginSystem $plugins */

function out($msg) { echo "    " . $msg . "\n"; }
function fail($msg) { fwrite(STDERR, "PROVISION ERROR: " . $msg . "\n"); exit(1); }

// ---------------------------------------------------------------------------
// Board settings tuned for deterministic testing
// ---------------------------------------------------------------------------
$board_settings = array(
    'dateformat'         => 'Y-m-d',
    'timeformat'         => 'H:i',
    // Remove the anti-flood and anti-bot friction that makes UI tests flaky.
    'postfloodcheck'     => '0',
    'postfloodsecs'      => '0',
    'searchfloodtime'    => '0',
    'failedlogincount'   => '0',
    'captchaimage'       => '0',
    'regtype'            => 'instant',
    'verifyemail'        => '0',
    'securityquestion'   => '0',
    'usereferrals'       => '0',
    // MyBB folds a member's back-to-back posts into one, which would fold the fixture
    // thread's replies by its author into its opening post.
    'postmergemins'      => '0',
    'minmessagelength'   => '1',
    'maxmessagelength'   => '0',
    'dstcorrection'      => '0',
    'timezoneoffset'     => '0',
    'relativetime'       => '0',
    // Send PHP/SQL errors to a file the e2e suite can assert on.
    'errorlogmedium'     => 'log',
    'errorloglocation'   => './cache/mybb_errors.log',
);
foreach ($board_settings as $name => $value) {
    $db->update_query('settings', array('value' => $db->escape_string($value)), "name = '" . $db->escape_string($name) . "'");
}
rebuild_settings();
out('board settings applied');

// ---------------------------------------------------------------------------
// Usergroups (cloned from "Registered" so every column gets a sane value)
// ---------------------------------------------------------------------------
function provision_usergroup($title)
{
    global $db, $cache;

    $existing = $db->fetch_array($db->simple_select('usergroups', 'gid', "title = '" . $db->escape_string($title) . "'"));
    if ($existing) {
        return (int)$existing['gid'];
    }

    $template = $db->fetch_array($db->simple_select('usergroups', '*', 'gid = 2'));
    unset($template['gid']);
    $template['title'] = $title;
    $template['type'] = 2; // user-assignable additional group
    $template['namestyle'] = '{username}';
    $template['usertitle'] = '';
    $template['isbannedgroup'] = 0;
    $template['candisplaygroup'] = 1;

    foreach ($template as $k => $v) {
        $template[$k] = $db->escape_string((string)$v);
    }

    $gid = (int)$db->insert_query('usergroups', $template);
    $cache->update_usergroups();
    return $gid;
}

$groups = array(
    // The only group, administrators aside, that can see the Staff Only forum.
    'staff' => provision_usergroup('Staff'),
);
out('usergroups: ' . json_encode($groups));

// ---------------------------------------------------------------------------
// Forums
// ---------------------------------------------------------------------------
function provision_forum($name, $pid)
{
    global $db, $cache;

    $existing = $db->fetch_array($db->simple_select('forums', 'fid', "name = '" . $db->escape_string($name) . "'"));
    if ($existing) {
        return (int)$existing['fid'];
    }

    $row = array(
        'name' => $db->escape_string($name),
        'description' => $db->escape_string($name),
        'linkto' => '',
        'type' => 'f',
        'pid' => (int)$pid,
        'parentlist' => '',
        'disporder' => 10,
        'active' => 1,
        'open' => 1,
        'allowhtml' => 0,
        'allowmycode' => 1,
        'allowsmilies' => 1,
        'allowimgcode' => 1,
        'allowvideocode' => 1,
        'allowpicons' => 1,
        'allowtratings' => 1,
        'usepostcounts' => 1,
        'usethreadcounts' => 1,
        'requireprefix' => 0,
        'password' => '',
        'showinjump' => 1,
        'style' => 0,
        'overridestyle' => 0,
        'rulestype' => 0,
        'rulestitle' => '',
        'rules' => '',
        'defaultdatecut' => 0,
        'defaultsortby' => '',
        'defaultsortorder' => '',
    );
    $fid = (int)$db->insert_query('forums', $row);
    $db->update_query('forums', array('parentlist' => (int)$pid . ',' . $fid), 'fid = ' . $fid);
    $cache->update_forums();
    return $fid;
}

// MyBB's default install ships "My Category" (fid 1) and "My Forum" (fid 2).
$category = $db->fetch_array($db->simple_select('forums', 'fid', "type = 'c'", array('order_by' => 'fid', 'limit' => 1)));
$category_fid = $category ? (int)$category['fid'] : 1;

$general_forum = $db->fetch_array($db->simple_select('forums', 'fid', "type = 'f'", array('order_by' => 'fid', 'limit' => 1)));
$forums = array(
    'general' => $general_forum ? (int)$general_forum['fid'] : provision_forum('General Discussion', $category_fid),
    'staff' => provision_forum('Staff Only', $category_fid),
);

// Staff Only is hidden from everybody but the Staff group and the administrators, so the
// suite has a post that exists but that an ordinary member may not react to.
$db->delete_query('forumpermissions', 'fid = ' . (int)$forums['staff']);
foreach (array(1, 2, 5, 7) as $hidden_from) {
    $db->insert_query('forumpermissions', array('fid' => (int)$forums['staff'], 'gid' => $hidden_from));
}
$staff_permissions = array('fid' => (int)$forums['staff'], 'gid' => (int)$groups['staff']);
foreach (array('canview', 'canviewthreads', 'candlattachments', 'canpostthreads', 'canpostreplys', 'canpostattachments', 'canratethreads', 'caneditposts', 'candeleteposts', 'candeletethreads', 'caneditattachments', 'canviewdeletionnotice', 'canpostpolls', 'canvotepolls', 'cansearch') as $permission) {
    $staff_permissions[$permission] = 1;
}
$db->insert_query('forumpermissions', $staff_permissions);
$cache->update_forumpermissions();
out('forums: ' . json_encode($forums));

// ---------------------------------------------------------------------------
// Fixture users
// ---------------------------------------------------------------------------
$FIXTURE_PASSWORD = 'testpass123';

$users = array(
    // Wrote the posts the suite reacts to, so receives the notifications.
    'author' => array('usergroup' => 2, 'additionalgroups' => array()),
    // Members who react.
    'trooper1' => array('usergroup' => 2, 'additionalgroups' => array()),
    'trooper2' => array('usergroup' => 2, 'additionalgroups' => array()),
    'trooper3' => array('usergroup' => 2, 'additionalgroups' => array()),
    // Has turned reaction notifications off in their User CP options.
    'optout' => array('usergroup' => 2, 'additionalgroups' => array(), 'reactions_notify' => 0),
    // Can see the Staff Only forum.
    'staff' => array('usergroup' => 2, 'additionalgroups' => array($groups['staff'])),
    // In MyBB's Banned group: can read the board, cannot react.
    'banned' => array('usergroup' => 7, 'additionalgroups' => array()),
);

$user_ids = array();
foreach ($users as $username => $spec) {
    $existing = $db->fetch_array($db->simple_select('users', 'uid', "username = '" . $db->escape_string($username) . "'"));
    if ($existing) {
        $uid = (int)$existing['uid'];
    } else {
        $handler = new UserDataHandler('insert');
        $handler->set_data(array(
            'username' => $username,
            'password' => $FIXTURE_PASSWORD,
            'password2' => $FIXTURE_PASSWORD,
            'email' => $username . '@example.test',
            'email2' => $username . '@example.test',
            'usergroup' => 2,
            'regip' => '127.0.0.1',
            'lastip' => '127.0.0.1',
            'language' => '',
            'regdate' => TIME_NOW,
        ));
        if (!$handler->validate_user()) {
            fail("could not create user {$username}: " . implode('; ', $handler->get_friendly_errors()));
        }
        $info = $handler->insert_user();
        $uid = (int)$info['uid'];
    }

    $db->update_query('users', array(
        'usergroup' => (int)$spec['usergroup'],
        'additionalgroups' => implode(',', $spec['additionalgroups']),
    ), 'uid = ' . $uid);

    $user_ids[$username] = $uid;
}
out('users: ' . json_encode($user_ids));

// ---------------------------------------------------------------------------
// Threads to react to
// ---------------------------------------------------------------------------

/**
 * A thread posted through MyBB's own post handler, so its forum, thread and user counts
 * are what posting it from the front end would have made them. Reused by subject.
 *
 * @return array tid, and pids in posting order
 */
function provision_thread($subject, $fid, $author, array $replies, $closed = false)
{
    global $db, $user_ids;

    $existing = $db->fetch_array($db->simple_select('threads', 'tid', "subject = '" . $db->escape_string($subject) . "'"));
    if ($existing) {
        $tid = (int)$existing['tid'];
    } else {
        $handler = new PostDataHandler('insert');
        $handler->action = 'thread';
        $handler->admin_override = true;
        $handler->set_data(array(
            'fid' => (int)$fid,
            'subject' => $subject,
            'uid' => $user_ids[$author],
            'username' => $author,
            'message' => "The opening post of {$subject}.",
            'ipaddress' => '127.0.0.1',
            'prefix' => 0,
            'icon' => 0,
            'savedraft' => 0,
            'options' => array('signature' => 0, 'subscriptionmethod' => '', 'disablesmilies' => 0),
        ));
        if (!$handler->validate_thread()) {
            fail("could not post thread {$subject}: " . implode('; ', $handler->get_friendly_errors()));
        }
        $info = $handler->insert_thread();
        $tid = (int)$info['tid'];

        foreach ($replies as $index => $replier) {
            $handler = new PostDataHandler('insert');
            $handler->admin_override = true;
            $handler->set_data(array(
                'tid' => $tid,
                'fid' => (int)$fid,
                'subject' => "RE: {$subject}",
                'uid' => $user_ids[$replier],
                'username' => $replier,
                'message' => 'Reply ' . ($index + 1) . " to {$subject}, by {$replier}.",
                'ipaddress' => '127.0.0.1',
                'icon' => 0,
                'savedraft' => 0,
                'options' => array('signature' => 0, 'subscriptionmethod' => '', 'disablesmilies' => 0),
            ));
            if (!$handler->validate_post()) {
                fail("could not reply to {$subject}: " . implode('; ', $handler->get_friendly_errors()));
            }
            $handler->insert_post();
        }
    }

    if ($closed) {
        $db->update_query('threads', array('closed' => 1), 'tid = ' . $tid);
    }

    $pids = array();
    $query = $db->simple_select('posts', 'pid', 'tid = ' . $tid, array('order_by' => 'dateline, pid'));
    while ($pid = $db->fetch_field($query, 'pid')) {
        $pids[] = (int)$pid;
    }

    return array('tid' => $tid, 'pids' => $pids);
}

$threads = array(
    // Three posts by the author, then one by trooper1 - so there is a post every fixture
    // member can react to without it being their own, and one trooper1 can react to as its
    // author.
    'main' => provision_thread('Reactions Test Thread', $forums['general'], 'author', array('author', 'author', 'trooper1')),
    // Closed threads can still be reacted to: closing stops replies, not readers.
    'closed' => provision_thread('Closed Thread', $forums['general'], 'author', array(), true),
    'staff' => provision_thread('Staff Thread', $forums['staff'], 'staff', array()),
);
out('threads: ' . json_encode($threads));

// ---------------------------------------------------------------------------
// Install + activate plugins through MyBB's real plugin code path
// ---------------------------------------------------------------------------
/**
 * @param string $codename  the plugin's file/function prefix
 * @param string $missing   what to tell the operator when the file isn't there
 */
function provision_activate_plugin($codename, $missing)
{
    // A plugin file's top level is where MyBB plugins register their hooks, and it runs in
    // whatever scope requires it - here, this function's. Smart Thread Link calls
    // $plugins->add_hook() straight out of file scope, so without these the include fatals
    // on a null $plugins.
    global $plugins, $mybb, $db, $cache, $lang;

    $plugin_file = MYBB_ROOT . "inc/plugins/{$codename}.php";
    if (!file_exists($plugin_file)) {
        fail("{$codename} plugin file missing at {$plugin_file} - {$missing}");
    }
    require_once $plugin_file;

    if (function_exists($codename . '_install') && !(function_exists($codename . '_is_installed') && call_user_func($codename . '_is_installed'))) {
        call_user_func($codename . '_install');
        out("{$codename} plugin installed");
    }
    if (function_exists($codename . '_activate')) {
        call_user_func($codename . '_activate');
        out("{$codename} plugin activated");
    }

    $plugin_cache = $cache->read('plugins');
    $active = isset($plugin_cache['active']) ? $plugin_cache['active'] : array();
    $active[$codename] = $codename;
    $cache->update('plugins', array('active' => $active));
}

provision_activate_plugin('reactions', 'run scripts/deploy.sh');

// Smart Thread Link supplies {$thread['smartlink']}, which is what the garrison theme's
// thread listings link with. Without it every thread subject in a forum renders as
// <a href="">, and the suite cannot reach a thread from its forum.
provision_activate_plugin('smartlink', 'run scripts/install-smartlink.sh');

// The opt-out user's preference lives on a column the plugin adds, so it can only be set
// once the plugin is installed.
foreach ($users as $username => $spec) {
    if (isset($spec['reactions_notify'])) {
        $db->update_query('users', array('reactions_notify' => (int)$spec['reactions_notify']), 'uid = ' . (int)$user_ids[$username]);
    }
}

// ---------------------------------------------------------------------------
// Emit the fixture map for the e2e suite
// ---------------------------------------------------------------------------
$reactions = array();
$query = $db->simple_select('reactions', 'rid, name');
while ($row = $db->fetch_array($query)) {
    $reactions[$row['name']] = (int)$row['rid'];
}

$fixtures = array(
    'password' => $FIXTURE_PASSWORD,
    'groups' => $groups,
    'forums' => $forums,
    'users' => $user_ids,
    'threads' => $threads,
    'reactions' => $reactions,
);
file_put_contents(MYBB_ROOT . 'reactions-fixtures.json', json_encode($fixtures, JSON_PRETTY_PRINT));
out('fixtures written to reactions-fixtures.json');

echo "PROVISION OK\n";
