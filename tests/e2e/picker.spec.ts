import { test, expect } from '../helpers/fixtures';
import { loginAs } from '../helpers/auth';
import { mainThread, react, reactionOf } from '../helpers/db';
import {
	bar,
	openPicker,
	openThread,
	picker,
	pickerItem,
	reactButton,
	settled,
} from '../helpers/reactions';

const opening = () => mainThread().pids[0];

/**
 * The picker opens the way Facebook's does: the mouse resting on the button, a finger
 * held on it, or the arrow keys - and a plain click never opens it, because a click is
 * the quick reaction.
 */
test.describe('the reaction picker', () => {
	test.beforeEach(async ({ page }) => {
		await loginAs(page, 'trooper1');
	});

	test('lists every active reaction, in order', async ({ page }) => {
		await openThread(page);
		await openPicker(page, opening());

		const names = await picker(page, opening())
			.locator('.reactions-picker-item')
			.evaluateAll((items) => items.map((item) => item.getAttribute('aria-label')));
		expect(names).toEqual(['Like', 'Love', 'Haha', 'Wow', 'Sad', 'Angry']);
	});

	test('opens only once the mouse has rested on the button, and closes when it leaves', async ({
		page,
	}) => {
		await openThread(page);

		await reactButton(page, opening()).hover();
		// Not yet: passing over the button on the way somewhere else should not pop it.
		await page.waitForTimeout(150);
		await expect(picker(page, opening())).toBeHidden();

		await expect(picker(page, opening())).toBeVisible();
		await expect(reactButton(page, opening())).toHaveAttribute('aria-expanded', 'true');

		// Crossing from the button into the picker keeps it open.
		await pickerItem(page, opening(), 'Wow').hover();
		await page.waitForTimeout(500);
		await expect(picker(page, opening())).toBeVisible();

		await page.mouse.move(5, 5);
		await expect(picker(page, opening())).toBeHidden();
		await expect(reactButton(page, opening())).toHaveAttribute('aria-expanded', 'false');
	});

	test('a plain click reacts rather than opening the picker', async ({ page }) => {
		await openThread(page);

		// Clicked without resting first, the way a hurried click lands.
		await reactButton(page, opening()).click({ delay: 0 });
		await settled(page, opening());

		expect(await reactionOf('trooper1', opening())).toBe('Like');
	});

	test('marks the reaction the member already has', async ({ page }) => {
		await react('trooper1', opening(), 'Haha');
		await openThread(page);
		await openPicker(page, opening());

		await expect(pickerItem(page, opening(), 'Haha')).toHaveAttribute('aria-pressed', 'true');
		await expect(pickerItem(page, opening(), 'Like')).toHaveAttribute('aria-pressed', 'false');
	});

	test('works from the keyboard', async ({ page }) => {
		await openThread(page);
		await reactButton(page, opening()).focus();

		await page.keyboard.press('ArrowUp');
		await expect(picker(page, opening())).toBeVisible();
		await expect(pickerItem(page, opening(), 'Like')).toBeFocused();

		await page.keyboard.press('ArrowRight');
		await page.keyboard.press('ArrowRight');
		await expect(pickerItem(page, opening(), 'Haha')).toBeFocused();
		await page.keyboard.press('ArrowLeft');
		await expect(pickerItem(page, opening(), 'Love')).toBeFocused();
		await page.keyboard.press('End');
		await expect(pickerItem(page, opening(), 'Angry')).toBeFocused();
		// Wraps round.
		await page.keyboard.press('ArrowRight');
		await expect(pickerItem(page, opening(), 'Like')).toBeFocused();

		await page.keyboard.press('Escape');
		await expect(picker(page, opening())).toBeHidden();
		await expect(reactButton(page, opening())).toBeFocused();

		await page.keyboard.press('ArrowDown');
		await page.keyboard.press('ArrowRight');
		await page.keyboard.press('Enter');
		await settled(page, opening());

		expect(await reactionOf('trooper1', opening())).toBe('Love');
		// Focus comes back to the redrawn button, so a keyboard user is not dropped at the
		// top of the page.
		await expect(reactButton(page, opening())).toBeFocused();
	});

	test('Enter on the button is the quick reaction', async ({ page }) => {
		await openThread(page);
		await reactButton(page, opening()).focus();

		await page.keyboard.press('Enter');
		await settled(page, opening());

		expect(await reactionOf('trooper1', opening())).toBe('Like');
	});

	test("opening one post's picker closes another's", async ({ page }) => {
		const [first, second] = mainThread().pids;
		await openThread(page);
		await reactButton(page, first).focus();
		await page.keyboard.press('ArrowUp');
		await expect(picker(page, first)).toBeVisible();

		await reactButton(page, second).focus();
		await page.keyboard.press('ArrowUp');

		await expect(picker(page, second)).toBeVisible();
		await expect(picker(page, first)).toBeHidden();
	});

	test('clicking elsewhere closes it', async ({ page }) => {
		await openThread(page);
		await openPicker(page, opening());

		await page.locator('body').click({ position: { x: 5, y: 5 } });

		await expect(picker(page, opening())).toBeHidden();
	});
});

test.describe('the reaction picker on a touch screen', () => {
	test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

	test.beforeEach(async ({ page }) => {
		await loginAs(page, 'trooper1');
	});

	/** Hold a finger on an element, the way a long press does. */
	async function longPress(page: import('@playwright/test').Page, selector: string, ms: number) {
		await page.locator(selector).scrollIntoViewIfNeeded();
		const box = (await page.locator(selector).boundingBox())!;
		const x = box.x + box.width / 2;
		const y = box.y + box.height / 2;
		const cdp = await page.context().newCDPSession(page);
		await cdp.send('Input.dispatchTouchEvent', {
			type: 'touchStart',
			touchPoints: [{ x, y }],
		});
		await page.waitForTimeout(ms);
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
		await cdp.detach();
	}

	test('a tap is the quick reaction', async ({ page }) => {
		await openThread(page);

		await reactButton(page, opening()).tap();
		await settled(page, opening());

		expect(await reactionOf('trooper1', opening())).toBe('Like');
	});

	test('holding the button opens the picker, without reacting', async ({ page }) => {
		await openThread(page);

		await longPress(page, `#reactions_${opening()} .reactions-button`, 800);

		await expect(picker(page, opening())).toBeVisible();
		await page.waitForTimeout(300);
		expect(await reactionOf('trooper1', opening())).toBeNull();

		await pickerItem(page, opening(), 'Sad').tap();
		await settled(page, opening());
		expect(await reactionOf('trooper1', opening())).toBe('Sad');
		await expect(bar(page, opening()).locator('.reactions-button')).toHaveText('Sad');
	});
});
