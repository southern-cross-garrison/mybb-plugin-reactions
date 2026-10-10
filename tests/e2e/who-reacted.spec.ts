import { test, expect } from '../helpers/fixtures';
import { loginAs, logout } from '../helpers/auth';
import { mainThread, react, rid } from '../helpers/db';
import { openThread, summary } from '../helpers/reactions';

const opening = () => mainThread().pids[0];

test.describe('who reacted', () => {
	test.beforeEach(async () => {
		await react('trooper1', opening(), 'Love');
		await react('trooper2', opening(), 'Haha');
		await react('trooper3', opening(), 'Love');
	});

	test('clicking the summary lists everybody, with a tab per reaction used', async ({ page }) => {
		await loginAs(page, 'author');
		await openThread(page);

		await summary(page, opening()).click();

		const modal = page.locator('.reactions-who-modal');
		await expect(modal).toBeVisible();
		await expect(modal.locator('.reactions-who-heading')).toHaveText("Reactions to author's post");

		const tabs = modal.locator('.reactions-who-tab');
		await expect(tabs).toHaveCount(3);
		await expect(tabs.nth(0)).toHaveText(/All\s+3/);
		await expect(tabs.nth(1)).toHaveText(/Love\s+2/);
		await expect(tabs.nth(2)).toHaveText(/Haha\s+1/);
		await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');

		const rows = modal.locator('.reactions-who-row:visible');
		await expect(rows).toHaveCount(3);
		// Newest first.
		await expect(rows.nth(0)).toContainText('trooper3');

		await tabs.nth(1).click();
		await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
		await expect(rows).toHaveCount(2);
		await expect(modal.locator('.reactions-who-row:visible', { hasText: 'trooper2' })).toHaveCount(
			0
		);

		await tabs.nth(2).click();
		await expect(rows).toHaveCount(1);
		await expect(rows.first()).toContainText('trooper2');

		// The names are profile links.
		await expect(rows.first().locator('a')).toHaveAttribute(
			'href',
			/member\.php\?action=profile&uid=\d+/
		);
	});

	test('guests can see who reacted', async ({ page }) => {
		await logout(page);
		await openThread(page);

		await expect(summary(page, opening())).toContainText('3');
		await summary(page, opening()).click();

		await expect(page.locator('.reactions-who-modal .reactions-who-row')).toHaveCount(3);
	});

	test('works as a page of its own, filtered by reaction, without a script', async ({
		browser,
	}) => {
		const context = await browser.newContext({ javaScriptEnabled: false });
		const page = await context.newPage();
		await loginAs(page, 'author');
		await page.goto(`/showthread.php?tid=${mainThread().tid}`);

		await summary(page, opening()).click();
		await expect(page).toHaveURL(new RegExp(`misc\\.php\\?action=reactions_who&pid=${opening()}$`));
		await expect(page.locator('.reactions-who-row')).toHaveCount(3);

		await page.locator('.reactions-who-tab', { hasText: 'Haha' }).click();
		await expect(page).toHaveURL(new RegExp(`rid=${rid('Haha')}`));
		await expect(page.locator('.reactions-who-row')).toHaveCount(1);
		await expect(page.locator('.reactions-who-row')).toContainText('trooper2');

		await page.locator('.reactions-who-back a').click();
		await expect(page).toHaveURL(
			new RegExp(`showthread\\.php\\?tid=${mainThread().tid}&pid=${opening()}#pid${opening()}`)
		);
		await context.close();
	});

	test('a post nobody has reacted to says so', async ({ page }) => {
		await loginAs(page, 'author');
		await page.goto(`/misc.php?action=reactions_who&pid=${mainThread().pids[1]}`);

		await expect(page.locator('.reactions-who-empty')).toHaveText(
			'Nobody has reacted to this post yet.'
		);
	});
});
