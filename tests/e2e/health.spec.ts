import type { Page } from '@playwright/test';
import { test, expect } from '../helpers/fixtures';
import { loginAs, loginToAdminCp } from '../helpers/auth';
import { mainThread, react, rid } from '../helpers/db';

/** Open a page and insist it came back as a page rather than an error. */
async function expectRenders(page: Page, url: string): Promise<void> {
	const response = await page.goto(url);
	expect(response?.status(), `${url} should not error`).toBeLessThan(400);
	await expect(page.locator('body'), `${url} should not show a MyBB SQL error`).not.toContainText(
		'MyBB SQL Error'
	);
}

/**
 * Broad sweeps over every page the plugin touches. PHP notices and SQL errors are logged
 * rather than shown, and the fixture fails any test that logs one - so rendering each page
 * is the assertion.
 */
test.describe('runtime health', () => {
	test('every front-end page the plugin touches renders cleanly', async ({ page }) => {
		const [first, second] = mainThread().pids;
		await react('trooper1', first, 'Love');
		await react('trooper2', first, 'Like');
		await react('trooper2', second, 'Haha');

		for (const user of ['trooper1', 'author', 'banned'] as const) {
			await loginAs(page, user);
			await expectRenders(page, `/showthread.php?tid=${mainThread().tid}`);
			await expectRenders(page, `/showthread.php?tid=${mainThread().tid}&mode=threaded`);
			await expectRenders(page, `/misc.php?action=reactions_who&pid=${first}`);
			await expectRenders(page, `/misc.php?action=reactions_who&pid=${first}&rid=${rid('Love')}`);
			await expectRenders(page, `/misc.php?action=reactions_who&pid=${first}&modal=1`);
			await expectRenders(page, '/usercp.php?action=options');
			await expectRenders(page, '/index.php');
		}

		// A post preview and the PM pages render the same postbit templates without the
		// postbit hook, so {$post['reactions']} has to be defined there some other way.
		await loginAs(page, 'author');
		await expectRenders(page, '/private.php');
		await expectRenders(page, `/newreply.php?tid=${mainThread().tid}`);
		// Posted rather than typed: the editor hides the textarea it stands in for.
		const key = await page.locator('input[name="my_post_key"]').first().getAttribute('value');
		const preview = await page.request.post('/newreply.php', {
			form: {
				action: 'do_newreply',
				tid: String(mainThread().tid),
				my_post_key: key ?? '',
				subject: 'RE: Reactions Test Thread',
				message: 'A preview of a reply',
				previewpost: 'Preview Post',
			},
		});
		expect(preview.status()).toBe(200);
		expect(await preview.text()).toContain('A preview of a reply');
	});

	test('the Admin CP pages render cleanly', async ({ page }) => {
		await react('trooper1', mainThread().pids[0], 'Love');
		await loginToAdminCp(page);
		for (const url of [
			'/admin/index.php?module=config-reactions',
			'/admin/index.php?module=config-reactions&action=add',
			`/admin/index.php?module=config-reactions&action=edit&rid=${rid('Love')}`,
			`/admin/index.php?module=config-reactions&action=delete&rid=${rid('Love')}`,
			'/admin/index.php?module=config-plugins',
			'/admin/index.php?module=config-settings&action=change&search=reactions',
			'/admin/index.php?module=tools-adminlog',
		]) {
			await expectRenders(page, url);
		}
	});
});
