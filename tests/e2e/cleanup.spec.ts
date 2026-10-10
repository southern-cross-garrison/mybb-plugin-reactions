import { test, expect } from '../helpers/fixtures';
import { runPhp } from '../helpers/container';
import {
	countReactions,
	countReactionsBy,
	execute,
	fixtures,
	mainThread,
	query,
	react,
	rid,
	T,
	uid,
} from '../helpers/db';
import { RowDataPacket } from 'mysql2/promise';

/**
 * Reactions go when what they belong to goes. Driven through MyBB's own Moderation class
 * and user data handler, which are what the front end's delete buttons and the Admin CP's
 * user deletion call, so it is MyBB's hooks that are being relied on.
 */
test.describe('when posts and members go', () => {
	async function notifiedRows(pid: number): Promise<number> {
		const rows = await query<RowDataPacket>(
			`SELECT COUNT(*) AS total FROM ${T('reactions_notified')} WHERE pid = ?`,
			[pid]
		);
		return Number(rows[0].total);
	}

	test('deleting a post deletes its reactions, and only its', async () => {
		const [first, second] = mainThread().pids;
		await react('trooper1', first, 'Love');
		await react('trooper2', second, 'Like');
		await execute(`INSERT INTO ${T('reactions_notified')} (pid, uid) VALUES (?, ?)`, [
			second,
			uid('trooper2'),
		]);

		await runPhp(`
require_once MYBB_ROOT.'inc/class_moderation.php';
$moderation = new Moderation;
$moderation->delete_post(${second});
echo "deleted";
`);

		expect(await countReactions(second)).toBe(0);
		expect(await notifiedRows(second)).toBe(0);
		expect(await countReactions(first)).toBe(1);
	});

	test('deleting a thread deletes the reactions to every post in it', async () => {
		const { tid, pids } = mainThread();
		for (const pid of pids) {
			await react('trooper1', pid, 'Wow');
		}
		const closed = fixtures().threads.closed.pids[0];
		await react('trooper1', closed, 'Wow');

		await runPhp(`
require_once MYBB_ROOT.'inc/class_moderation.php';
$moderation = new Moderation;
$moderation->delete_thread(${tid});
echo "deleted";
`);

		for (const pid of pids) {
			expect(await countReactions(pid)).toBe(0);
		}
		expect(await countReactions(closed)).toBe(1);
	});

	test('merging posts keeps the reactions to the post merged into', async () => {
		const [, second, third] = mainThread().pids;
		await react('trooper1', second, 'Love');
		await react('trooper2', third, 'Haha');

		await runPhp(`
require_once MYBB_ROOT.'inc/class_moderation.php';
$moderation = new Moderation;
$moderation->merge_posts(array(${second}, ${third}), ${mainThread().tid});
echo "merged";
`);

		expect(await countReactions(second)).toBe(1);
		expect(await countReactions(third)).toBe(0);
	});

	test('deleting a member deletes the reactions they made', async () => {
		const [first, second] = mainThread().pids;
		const created = await runPhp(`
require_once MYBB_ROOT.'inc/functions_user.php';
require_once MYBB_ROOT.'inc/datahandlers/user.php';
$lang->load('global');
$handler = new UserDataHandler('insert');
$handler->set_data(array(
    'username' => 'leaving',
    'password' => 'testpass123',
    'password2' => 'testpass123',
    'email' => 'leaving@example.test',
    'email2' => 'leaving@example.test',
    'usergroup' => 2,
    'regip' => '127.0.0.1',
    'lastip' => '127.0.0.1',
    'language' => '',
    'regdate' => TIME_NOW,
));
if(!$handler->validate_user()) { echo "INVALID:".implode('; ', $handler->get_friendly_errors()); exit; }
$info = $handler->insert_user();
echo "UID:".$info['uid'];
`);
		const leaving = Number(created.match(/UID:(\d+)/)?.[1]);
		expect(leaving).toBeGreaterThan(0);

		await execute(
			`INSERT INTO ${T('reactions_post')} (pid, uid, rid, dateline) VALUES (?, ?, ?, 0), (?, ?, ?, 0)`,
			[first, leaving, rid('Love'), second, leaving, rid('Sad')]
		);
		await react('trooper1', first, 'Like');

		await runPhp(`
require_once MYBB_ROOT.'inc/functions_user.php';
require_once MYBB_ROOT.'inc/datahandlers/user.php';
$handler = new UserDataHandler('delete');
$handler->delete_user(array(${leaving}), 0);
echo "deleted";
`);

		const left = await query<RowDataPacket>(
			`SELECT COUNT(*) AS total FROM ${T('reactions_post')} WHERE uid = ?`,
			[leaving]
		);
		expect(Number(left[0].total)).toBe(0);
		expect(await countReactionsBy('trooper1')).toBe(1);
	});
});
