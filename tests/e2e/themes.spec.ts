import { test, expect } from '../helpers/fixtures';
import { loginAs } from '../helpers/auth';
import { mainThread, queryOne, reactionOf, setUserColumn } from '../helpers/db';
import { bar, clickReact, openThread, pickReaction } from '../helpers/reactions';
import { RowDataPacket } from 'mysql2/promise';

const opening = () => mainThread().pids[0];

/**
 * The bar is put into the post by a template edit, anchored on the signature, so it has
 * to land in the right place on MyBB's own templates as well as on the garrison theme's.
 */
test.describe('the bar on each theme', () => {
	test('on the garrison theme it sits in the post card, under the message', async ({ page }) => {
		await loginAs(page, 'trooper1');
		await openThread(page);

		const post = page.locator(`#post_${opening()}`);
		await expect(post.locator('.card-body > .reactions')).toHaveCount(1);
		// Outside the message: quick edit replaces the message's container wholesale.
		await expect(page.locator(`#pid_${opening()} .reactions`)).toHaveCount(0);

		await clickReact(page, opening());
		expect(await reactionOf('trooper1', opening())).toBe('Like');
	});

	test("on MyBB's default theme it sits in the post content, under the message", async ({
		page,
	}) => {
		const theme = await queryOne<RowDataPacket>(
			"SELECT tid FROM mybb_themes WHERE name = 'Default'"
		);
		await setUserColumn('trooper1', 'style', Number(theme!.tid));
		try {
			await loginAs(page, 'trooper1');
			await openThread(page);

			const post = page.locator(`#post_${opening()}`);
			await expect(post.locator('.post_content > .reactions')).toHaveCount(1);
			await expect(page.locator(`#pid_${opening()} .reactions`)).toHaveCount(0);
			// Only once, though both postbit templates were edited.
			await expect(page.locator('.reactions')).toHaveCount(mainThread().pids.length);

			await pickReaction(page, opening(), 'Wow');
			expect(await reactionOf('trooper1', opening())).toBe('Wow');
			await expect(bar(page, opening()).locator('.reactions-summary')).toBeVisible();

			// The classic layout is the other template the edit made.
			await setUserColumn('trooper1', 'classicpostbit', 1);
			await openThread(page);
			await expect(
				page.locator(`#post_${opening()}.classic .post_content > .reactions`)
			).toHaveCount(1);
		} finally {
			await setUserColumn('trooper1', 'style', 0);
			await setUserColumn('trooper1', 'classicpostbit', 0);
		}
	});
});
