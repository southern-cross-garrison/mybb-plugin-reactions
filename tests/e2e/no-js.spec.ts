import { test, expect } from '../helpers/fixtures';
import { loginAs } from '../helpers/auth';
import { mainThread, reactionOf } from '../helpers/db';
import { picker, pickerItem, reactButton } from '../helpers/reactions';

const opening = () => mainThread().pids[0];

/**
 * Without a script the bar is a plain form: the button and the picker's items are submit
 * buttons, the stylesheet shows the picker on hover and focus, and the endpoint answers a
 * form post by sending the member back to the post.
 */
test.describe('without a script', () => {
	test.use({ javaScriptEnabled: false });

	test('the button and the picker still react, landing back on the post', async ({ page }) => {
		await loginAs(page, 'trooper1');
		await page.goto(`/showthread.php?tid=${mainThread().tid}`);

		await reactButton(page, opening()).click();
		await expect(page).toHaveURL(new RegExp(`pid=${opening()}#pid${opening()}$`));
		expect(await reactionOf('trooper1', opening())).toBe('Like');
		await expect(reactButton(page, opening())).toHaveText('Like');
		await expect(reactButton(page, opening())).toHaveAttribute('aria-pressed', 'true');

		await expect(picker(page, opening())).toBeHidden();
		await reactButton(page, opening()).hover();
		await expect(picker(page, opening())).toBeVisible();
		await pickerItem(page, opening(), 'Love').click();
		await expect(page).toHaveURL(new RegExp(`#pid${opening()}$`));
		expect(await reactionOf('trooper1', opening())).toBe('Love');

		await reactButton(page, opening()).click();
		expect(await reactionOf('trooper1', opening())).toBeNull();
	});

	test('tabbing into the bar shows the picker', async ({ page }) => {
		await loginAs(page, 'trooper1');
		await page.goto(`/showthread.php?tid=${mainThread().tid}`);

		await reactButton(page, opening()).focus();

		await expect(picker(page, opening())).toBeVisible();
	});
});
