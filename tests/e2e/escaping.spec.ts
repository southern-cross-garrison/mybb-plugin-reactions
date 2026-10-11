import { test, expect } from '../helpers/fixtures';
import { loginAs, loginToAdminCp, gotoReactionsAdmin } from '../helpers/auth';
import { getPrivateMessages, mainThread, react, updateReaction } from '../helpers/db';
import { bar, clickReact, openThread, reactButton, summary } from '../helpers/reactions';

const opening = () => mainThread().pids[0];
const NAME = `<b>Bold</b> & "Co"`;

/**
 * A reaction's name is whatever an administrator typed, and it reaches the picker, the
 * button, the summary, the list of who reacted, the Admin CP and the PM an author is
 * sent. Everywhere it is text, never markup.
 */
test.describe('reaction names are escaped', () => {
	test.beforeEach(async () => {
		await updateReaction('Like', { name: NAME });
	});

	test('on the thread page and in the list of who reacted', async ({ page }) => {
		await react('trooper2', opening(), 'Like');
		await loginAs(page, 'trooper1');
		await openThread(page);

		await expect(bar(page, opening()).locator('b')).toHaveCount(0);
		await expect(reactButton(page, opening())).toHaveText(NAME);
		// Like is the first reaction in the picker.
		const item = bar(page, opening()).locator('.reactions-picker-item').first();
		await expect(item).toHaveAttribute('aria-label', NAME);
		await expect(summary(page, opening()).locator('img').first()).toHaveAttribute('alt', NAME);

		await page.goto(`/misc.php?action=reactions_who&pid=${opening()}`);
		await expect(page.locator('.reactions-who b')).toHaveCount(0);
		await expect(page.locator('.reactions-who-tab').nth(1)).toContainText(NAME);
	});

	test('in the Admin CP', async ({ page }) => {
		await loginToAdminCp(page);
		await gotoReactionsAdmin(page);

		const row = page.locator('tr', { hasText: 'Bold' });
		await expect(row.locator('b')).toHaveCount(0);
		await expect(row).toContainText(NAME);
	});

	test('in the PM an author is sent', async ({ page }) => {
		await loginAs(page, 'trooper1');
		await openThread(page);
		await clickReact(page, opening());

		const [message] = await getPrivateMessages('author');
		expect(message.message).toContain(`with: ${NAME}`);

		await loginAs(page, 'author');
		await page.goto(`/private.php?action=read&pmid=${message.pmid}`);
		await expect(page.locator('.post_body b, [id^="pid_"] b')).toHaveCount(0);
		await expect(page.locator('body')).toContainText(`with: ${NAME}`);
	});
});
