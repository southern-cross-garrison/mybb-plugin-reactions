import { Page, Locator, APIResponse, expect } from '@playwright/test';
import { mainThread } from './db';

/**
 * Driving the reactions bar the way a member does.
 */

export const bar = (page: Page, pid: number): Locator => page.locator(`#reactions_${pid}`);

export const reactButton = (page: Page, pid: number): Locator =>
	bar(page, pid).locator('.reactions-button');

export const picker = (page: Page, pid: number): Locator =>
	bar(page, pid).locator('.reactions-picker');

export const pickerItem = (page: Page, pid: number, name: string): Locator =>
	bar(page, pid).locator(`.reactions-picker-item[aria-label="${name}"]`);

export const summary = (page: Page, pid: number): Locator =>
	bar(page, pid).locator('.reactions-summary');

/** The reactions a post's summary pictures, by name, in the order shown. */
export async function summaryIcons(page: Page, pid: number): Promise<string[]> {
	return bar(page, pid)
		.locator('.reactions-summary-icons img')
		.evaluateAll((images) => images.map((image) => image.getAttribute('alt') ?? ''));
}

/** Open a thread - "Reactions Test Thread" unless told otherwise. */
export async function openThread(page: Page, tid = mainThread().tid): Promise<void> {
	await page.goto(`/showthread.php?tid=${tid}`);
	// The script is deferred; the bar is not interactive until it has run.
	await expect(page.locator('html.reactions-js')).toHaveCount(1);
}

/** Wait for a reaction request on a post to finish and its bar to be redrawn. */
export async function settled(page: Page, pid: number): Promise<void> {
	await expect(bar(page, pid)).not.toHaveAttribute('aria-busy', 'true');
}

/** Rest the mouse on the React button until the picker opens. */
export async function openPicker(page: Page, pid: number): Promise<void> {
	await reactButton(page, pid).hover();
	await expect(picker(page, pid)).toBeVisible();
}

/** Pick a reaction from a post's picker, and wait for the bar to be redrawn. */
export async function pickReaction(page: Page, pid: number, name: string): Promise<void> {
	await openPicker(page, pid);
	const response = page.waitForResponse(
		(r) => r.url().includes('/misc.php') && r.request().method() === 'POST'
	);
	await pickerItem(page, pid, name).click();
	expect((await response).status()).toBe(200);
	await settled(page, pid);
}

/** Click the React button itself - the quick reaction - and wait for the bar to be redrawn. */
export async function clickReact(page: Page, pid: number): Promise<void> {
	const response = page.waitForResponse(
		(r) => r.url().includes('/misc.php') && r.request().method() === 'POST'
	);
	await reactButton(page, pid).click();
	expect((await response).status()).toBe(200);
	await settled(page, pid);
}

/** The post key on the current page, as the reactions bar's forms carry it. */
export async function postKey(page: Page): Promise<string> {
	const key = await page.locator('input[name="my_post_key"]').first().getAttribute('value');
	if (!key) {
		throw new Error('No my_post_key on the page');
	}
	return key;
}

/**
 * Post to the reactions endpoint directly, as the logged-in member of the page's context -
 * for the requests the page itself would never make (another member's forum, a
 * deactivated reaction, a forged key).
 */
export async function postReaction(
	page: Page,
	fields: { pid: number; rid: number | string; key?: string; ajax?: boolean }
): Promise<APIResponse> {
	const form: Record<string, string> = {
		action: 'reactions_react',
		pid: String(fields.pid),
		rid: String(fields.rid),
		my_post_key: fields.key ?? '',
	};
	if (fields.ajax !== false) {
		form.ajax = '1';
	}
	return page.request.post('/misc.php', { form, maxRedirects: 0 });
}
