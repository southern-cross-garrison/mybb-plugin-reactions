import { test, expect } from '../helpers/fixtures';
import { loginAs } from '../helpers/auth';
import { mainThread, queryOne, reactionOf } from '../helpers/db';
import { clickReact, openThread, pickReaction } from '../helpers/reactions';
import { RowDataPacket } from 'mysql2/promise';

/**
 * Quick reply adds the new post to the page without reloading it. Its bar comes back with
 * the post, and has to work without the page having wired it up.
 */
test('a post added by quick reply has a working reactions bar', async ({ page }) => {
	await loginAs(page, 'trooper2');
	await openThread(page);

	const message = page.locator('#quick_reply_form textarea[name="message"]');
	await message.fill('A quick reply to react to');
	const posted = page.waitForResponse(
		(r) => r.url().includes('newreply.php') && r.request().method() === 'POST'
	);
	await page.locator('#quick_reply_submit').click();
	await posted;

	const row = await queryOne<RowDataPacket>(
		'SELECT pid FROM mybb_posts WHERE tid = ? ORDER BY pid DESC LIMIT 1',
		[mainThread().tid]
	);
	const pid = Number(row!.pid);
	expect(mainThread().pids).not.toContain(pid);
	await expect(page.locator(`#reactions_${pid}`)).toBeVisible();

	await clickReact(page, pid);
	expect(await reactionOf('trooper2', pid)).toBe('Like');
	await pickReaction(page, pid, 'Love');
	expect(await reactionOf('trooper2', pid)).toBe('Love');
});
