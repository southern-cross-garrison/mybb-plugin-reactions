import { test, expect } from '../helpers/fixtures';
import { loginAs, logout } from '../helpers/auth';
import {
	countReactions,
	execute,
	fixtures,
	mainThread,
	react,
	reactionOf,
	rid,
	T,
	updateReaction,
} from '../helpers/db';
import { bar, openThread, postKey, postReaction, reactButton, summary } from '../helpers/reactions';

const opening = () => mainThread().pids[0];

/**
 * Who may react, and to what - checked at the endpoint, not just by what the page offers,
 * since anything the page leaves out can still be posted by hand.
 */
test.describe('who may react', () => {
	test('guests see the summary but no button, and cannot react by posting', async ({ page }) => {
		await react('trooper1', opening(), 'Love');
		await logout(page);
		await openThread(page);

		await expect(summary(page, opening())).toBeVisible();
		await expect(reactButton(page, opening())).toHaveCount(0);
		// A post nobody has reacted to has nothing to show a guest at all.
		await expect(bar(page, mainThread().pids[1])).toHaveCount(0);

		const response = await postReaction(page, { pid: opening(), rid: rid('Like'), key: '' });
		expect(response.status()).toBe(403);
		expect(await countReactions(opening())).toBe(1);
	});

	test('a guest with a forged key is still turned away', async ({ page }) => {
		await logout(page);
		await openThread(page);
		const key = await postKey(page);

		const response = await postReaction(page, { pid: opening(), rid: rid('Like'), key });

		expect(response.status()).toBe(401);
		expect((await response.json()).error).toContain('logged in');
		expect(await countReactions(opening())).toBe(0);
	});

	test('banned members cannot react: they cannot see the board', async ({ page }) => {
		await react('trooper1', opening(), 'Love');
		await loginAs(page, 'banned');

		// The plugin has no ban check of its own. MyBB's Banned group cannot view the board,
		// and a member who cannot see a post cannot react to it.
		await page.goto(`/showthread.php?tid=${mainThread().tid}`);
		await expect(page.locator('body')).toContainText('Your forum account is currently banned');
		await expect(reactButton(page, opening())).toHaveCount(0);

		const response = await postReaction(page, { pid: opening(), rid: rid('Like'), key: '' });
		expect(await response.text()).not.toContain('"result"');
		expect(await reactionOf('banned', opening())).toBeNull();
	});

	test('a post in a forum the member cannot see cannot be reacted to', async ({ page }) => {
		const staffPost = fixtures().threads.staff.pids[0];
		await loginAs(page, 'trooper1');
		await openThread(page);

		const response = await postReaction(page, {
			pid: staffPost,
			rid: rid('Like'),
			key: await postKey(page),
		});

		expect(response.status()).toBe(403);
		expect(await countReactions(staffPost)).toBe(0);

		// Nor can they see who reacted to it.
		await react('staff', staffPost, 'Love');
		await page.goto(`/misc.php?action=reactions_who&pid=${staffPost}`);
		await expect(page.locator('body')).not.toContainText('staff');
		await expect(page.locator('.reactions-who-row')).toHaveCount(0);
	});

	test('a member who can see the forum can react there', async ({ page }) => {
		const { tid, pids } = fixtures().threads.staff;
		await loginAs(page, 'staff');
		await openThread(page, tid);

		await reactButton(page, pids[0]).click();
		await expect.poll(() => reactionOf('staff', pids[0])).toBe('Like');
	});

	test('the post key is required', async ({ page }) => {
		await loginAs(page, 'trooper1');
		await openThread(page);

		const missing = await postReaction(page, { pid: opening(), rid: rid('Like'), key: '' });
		expect(missing.status()).toBe(403);

		const wrong = await postReaction(page, {
			pid: opening(),
			rid: rid('Like'),
			key: 'f'.repeat(32),
		});
		expect(wrong.status()).toBe(403);

		expect(await countReactions(opening())).toBe(0);
	});

	test('only a POST reacts', async ({ page }) => {
		await loginAs(page, 'trooper1');
		await openThread(page);
		const key = await postKey(page);

		const response = await page.request.get(
			`/misc.php?action=reactions_react&pid=${opening()}&rid=${rid('Like')}&my_post_key=${key}&ajax=1`
		);

		expect(response.status()).toBe(405);
		expect(await countReactions(opening())).toBe(0);
	});

	test('a deactivated reaction is refused, and not offered', async ({ page }) => {
		await updateReaction('Angry', { active: false });
		await loginAs(page, 'trooper1');
		await openThread(page);

		await expect(
			bar(page, opening()).locator('.reactions-picker-item[aria-label="Angry"]')
		).toHaveCount(0);

		const response = await postReaction(page, {
			pid: opening(),
			rid: rid('Angry'),
			key: await postKey(page),
		});
		expect(response.status()).toBe(400);
		expect((await response.json()).error).toBe('That reaction is not available.');
		expect(await countReactions(opening())).toBe(0);
	});

	test('a reaction that does not exist is refused', async ({ page }) => {
		await loginAs(page, 'trooper1');
		await openThread(page);

		const response = await postReaction(page, {
			pid: opening(),
			rid: 99999,
			key: await postKey(page),
		});

		expect(response.status()).toBe(400);
		expect(await countReactions(opening())).toBe(0);
	});

	test('a post that does not exist is refused', async ({ page }) => {
		await loginAs(page, 'trooper1');
		await openThread(page);

		const response = await postReaction(page, {
			pid: 99999,
			rid: rid('Like'),
			key: await postKey(page),
		});

		expect(response.status()).toBe(404);
	});

	test('an unapproved or deleted post is refused, and moderators get no button on one', async ({
		page,
	}) => {
		const target = mainThread().pids[2];
		await loginAs(page, 'trooper1');
		await openThread(page);
		const key = await postKey(page);

		for (const visible of [0, -1]) {
			await execute(`UPDATE ${T('posts')} SET visible = ? WHERE pid = ?`, [visible, target]);
			const response = await postReaction(page, { pid: target, rid: rid('Like'), key });
			expect(response.status(), `visible = ${visible}`).toBe(404);
		}
		expect(await countReactions(target)).toBe(0);

		// An administrator sees the post (as a moderator does), but not a way to react to it.
		await loginAs(page, 'admin');
		await openThread(page);
		await expect(page.locator(`#post_${target}`)).toHaveCount(1);
		await expect(reactButton(page, target)).toHaveCount(0);
	});

	test('the no-script form path turns failures into MyBB error pages', async ({ page }) => {
		await loginAs(page, 'trooper1');
		await openThread(page);

		const response = await postReaction(page, {
			pid: opening(),
			rid: 99999,
			key: await postKey(page),
			ajax: false,
		});

		expect(response.status()).toBe(200);
		expect(await response.text()).toContain('That reaction is not available.');
	});
});
