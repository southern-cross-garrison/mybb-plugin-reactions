/**
 * Screenshots for the members' guide (docs/src/content/docs/members/).
 *
 * Runs against the dev forum with the test suite's fixtures and logins, so no real
 * member's details ever appear in the public guide.
 *
 *   pnpm screenshots          # every guide, from docs/
 *   pnpm screenshots members  # just this file
 */
import { test, expect } from '../../tests/helpers/fixtures';
import { loginAs } from '../../tests/helpers/auth';
import { getPrivateMessages, mainThread, react } from '../../tests/helpers/db';
import {
	bar,
	clickReact,
	openPicker,
	openThread,
	pickReaction,
	picker,
	reactButton,
	summary,
} from '../../tests/helpers/reactions';
import { ring, shot } from './annotate';

const opening = () => mainThread().pids[0];
const post = (page: import('@playwright/test').Page, pid: number) => page.locator(`#post_${pid}`);

test.describe('members: reacting', () => {
	test.beforeEach(async () => {
		await react('trooper2', opening(), 'Love');
		await react('trooper3', opening(), 'Like');
		await react('staff', opening(), 'Love');
		await react('author', opening(), 'Haha');
	});

	test('the reactions bar, the picker, and a reaction made', async ({ page }) => {
		await loginAs(page, 'trooper1');
		await openThread(page);

		await ring(reactButton(page, opening()));
		await shot(post(page, opening()), 'members/react-button', {
			include: [summary(page, opening())],
		});

		await openPicker(page, opening());
		// Off the picker, so no reaction is shown zoomed as if pointed at.
		await page.mouse.move(5, 5);
		await ring(picker(page, opening()));
		await shot(post(page, opening()), 'members/picker');

		// Moving away leaves the picker open; clicking elsewhere closes it.
		await page.locator('body').click({ position: { x: 5, y: 5 } });
		await expect(picker(page, opening())).toBeHidden();
		await pickReaction(page, opening(), 'Love');
		await page.mouse.move(5, 5);
		await expect(picker(page, opening())).toBeHidden();
		await ring(reactButton(page, opening()), summary(page, opening()));
		await shot(post(page, opening()), 'members/reacted');
	});

	test('who reacted', async ({ page }) => {
		await loginAs(page, 'trooper1');
		await openThread(page);

		await ring(summary(page, opening()));
		await shot(post(page, opening()), 'members/summary');

		await summary(page, opening()).click();
		const modal = page.locator('.reactions-who-modal');
		await expect(modal.locator('.reactions-who-row')).toHaveCount(4);
		// Faded all the way in, not caught part way.
		await expect(page.locator('.blocker')).toHaveCSS('opacity', '1');
		await expect(modal).toHaveCSS('opacity', '1');
		await shot(modal, 'members/who-reacted');
	});

	test('the notification, and turning them off', async ({ page }) => {
		await loginAs(page, 'trooper1');
		await openThread(page);
		await clickReact(page, opening());

		await loginAs(page, 'author');
		const [message] = await getPrivateMessages('author');
		await page.goto(`/private.php?action=read&pmid=${message.pmid}`);
		await shot(page.locator(`[id^="pid_"], .post_body`).first(), 'members/notification');

		await page.goto('/usercp.php?action=options');
		await ring(page.locator('.reactions-usercp-option'));
		await shot(page.locator('form[action="usercp.php"]'), 'members/usercp-option');
	});

	test('the bar on a phone', async ({ browser }) => {
		const context = await browser.newContext({
			viewport: { width: 390, height: 844 },
			deviceScaleFactor: 3,
			isMobile: true,
			hasTouch: true,
		});
		const page = await context.newPage();
		await loginAs(page, 'trooper1');
		await openThread(page);
		// The picker as a held finger leaves it - opened from the keyboard here, which is the
		// same picker without needing a real touch screen.
		await reactButton(page, opening()).focus();
		await page.keyboard.press('ArrowUp');
		await expect(picker(page, opening())).toBeVisible();
		await page.locator(':focus').blur();
		await shot(post(page, opening()), 'members/picker-phone');
		await expect(bar(page, opening())).toBeVisible();
		await context.close();
	});
});
