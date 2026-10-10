import { test, expect } from '../helpers/fixtures';
import { loginAs } from '../helpers/auth';
import { mainThread, react, reactionOf } from '../helpers/db';
import {
	bar,
	holdMouse,
	openPicker,
	openThread,
	picker,
	pickerItem,
	reactButton,
	settled,
} from '../helpers/reactions';

const opening = () => mainThread().pids[0];

/**
 * The picker opens on a long press - the mouse or a finger held on the button - or the
 * arrow keys. A plain click never opens it, because a click is the quick reaction, and
 * neither does hovering: the button sits among the post's controls, in the way of the
 * pointer on its way to Edit.
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

	test('hovering does not open it; holding the mouse button down does, without reacting', async ({
		page,
	}) => {
		await openThread(page);

		await reactButton(page, opening()).hover();
		await page.waitForTimeout(800);
		await expect(picker(page, opening())).toBeHidden();

		await holdMouse(page, reactButton(page, opening()));
		await expect(picker(page, opening())).toBeVisible();
		await expect(reactButton(page, opening())).toHaveAttribute('aria-expanded', 'true');
		// The click that ends the hold is not the quick reaction.
		await page.waitForTimeout(300);
		expect(await reactionOf('trooper1', opening())).toBeNull();

		// It stays open once the mouse has moved off, until something is picked.
		await page.mouse.move(5, 5);
		await page.waitForTimeout(500);
		await expect(picker(page, opening())).toBeVisible();

		await pickerItem(page, opening(), 'Wow').click();
		await settled(page, opening());
		expect(await reactionOf('trooper1', opening())).toBe('Wow');
	});

	test('a hold that wanders off the button does not open it', async ({ page }) => {
		await openThread(page);
		const box = (await reactButton(page, opening()).boundingBox())!;

		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await page.mouse.down();
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 40);
		await page.waitForTimeout(800);
		await page.mouse.up();

		await expect(picker(page, opening())).toBeHidden();
		expect(await reactionOf('trooper1', opening())).toBeNull();
	});

	test('holding the button, sliding onto a reaction and letting go picks it', async ({ page }) => {
		await openThread(page);
		const button = (await reactButton(page, opening()).boundingBox())!;

		await page.mouse.move(button.x + button.width / 2, button.y + button.height / 2);
		await page.mouse.down();
		await expect(picker(page, opening())).toBeVisible();

		const haha = (await pickerItem(page, opening(), 'Haha').boundingBox())!;
		await page.mouse.move(haha.x + haha.width / 2, haha.y + haha.height / 2, { steps: 5 });
		await expect(pickerItem(page, opening(), 'Haha')).toHaveClass(/reactions-picker-item--hover/);
		await page.mouse.up();
		await settled(page, opening());

		expect(await reactionOf('trooper1', opening())).toBe('Haha');
		await expect(reactButton(page, opening())).toHaveText('Haha');
	});

	test("a press that starts on the button's icon is a press on the button, not a drag", async ({
		page,
	}) => {
		await openThread(page);
		// A real browser that starts dragging the picture cancels the press and swallows
		// the release; Playwright's mouse carries on regardless, so watch for the drag.
		await page.evaluate(() => {
			(window as any).drags = 0;
			document.addEventListener('dragstart', () => (window as any).drags++);
		});
		const icon = (await reactButton(page, opening()).locator('img').boundingBox())!;

		await page.mouse.move(icon.x + icon.width / 2, icon.y + icon.height / 2);
		await page.mouse.down();
		await expect(picker(page, opening())).toBeVisible();

		const love = (await pickerItem(page, opening(), 'Love').boundingBox())!;
		await page.mouse.move(love.x + love.width / 2, love.y + love.height / 2, { steps: 5 });
		await page.mouse.up();
		await settled(page, opening());

		expect(await page.evaluate(() => (window as any).drags)).toBe(0);
		expect(await reactionOf('trooper1', opening())).toBe('Love');
	});

	test('letting go off the picker leaves it open, without reacting', async ({ page }) => {
		await openThread(page);
		const button = (await reactButton(page, opening()).boundingBox())!;

		await page.mouse.move(button.x + button.width / 2, button.y + button.height / 2);
		await page.mouse.down();
		await expect(picker(page, opening())).toBeVisible();
		await page.mouse.move(button.x + button.width / 2, button.y + 200, { steps: 5 });
		await page.mouse.up();

		await page.waitForTimeout(300);
		await expect(picker(page, opening())).toBeVisible();
		expect(await reactionOf('trooper1', opening())).toBeNull();
	});

	test('a picker too wide to open leftward is kept on screen', async ({ page }) => {
		await page.setViewportSize({ width: 360, height: 800 });
		await openThread(page);
		await openPicker(page, opening());

		const box = (await picker(page, opening()).boundingBox())!;
		expect(box.x).toBeGreaterThanOrEqual(0);
		expect(box.x + box.width).toBeLessThanOrEqual(360);
	});

	test('a plain click reacts rather than opening the picker', async ({ page }) => {
		await openThread(page);

		await reactButton(page, opening()).click();
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

	test('holding, sliding onto a reaction and lifting the finger picks it', async ({ page }) => {
		await openThread(page);
		await reactButton(page, opening()).scrollIntoViewIfNeeded();
		const button = (await reactButton(page, opening()).boundingBox())!;
		const cdp = await page.context().newCDPSession(page);
		await cdp.send('Input.dispatchTouchEvent', {
			type: 'touchStart',
			touchPoints: [{ x: button.x + button.width / 2, y: button.y + button.height / 2 }],
		});
		await expect(picker(page, opening())).toBeVisible();

		const wow = (await pickerItem(page, opening(), 'Wow').boundingBox())!;
		const scrollY = await page.evaluate(() => window.scrollY);
		await cdp.send('Input.dispatchTouchEvent', {
			type: 'touchMove',
			touchPoints: [{ x: wow.x + wow.width / 2, y: wow.y + wow.height / 2 }],
		});
		await expect(pickerItem(page, opening(), 'Wow')).toHaveClass(/reactions-picker-item--hover/);
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
		await cdp.detach();
		await settled(page, opening());

		expect(await reactionOf('trooper1', opening())).toBe('Wow');
		// The slide chose a reaction rather than scrolling the page.
		expect(await page.evaluate(() => window.scrollY)).toBe(scrollY);
	});
});
