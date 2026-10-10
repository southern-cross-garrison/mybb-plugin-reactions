/**
 * Screenshots for the administrators' and webmasters' guides.
 *
 *   pnpm screenshots admins
 */
import type { Page } from '@playwright/test';
import { test, expect } from '../../tests/helpers/fixtures';
import { gotoReactionsAdmin, loginToAdminCp } from '../../tests/helpers/auth';
import { mainThread, react, rid } from '../../tests/helpers/db';
import { ring, shot } from './annotate';

/** A 96px PNG of an emoji, drawn by the browser, to upload as a new reaction. */
async function emojiPng(page: Page, emoji: string): Promise<Buffer> {
	const scratch = await page.context().newPage();
	await scratch.setContent(
		`<div id="e" style="font-size:80px;line-height:96px;width:96px;text-align:center">${emoji}</div>`
	);
	const image = await scratch.locator('#e').screenshot({ omitBackground: true });
	await scratch.close();
	return image;
}

const content = (page: Page) => page.locator('#content');

test.describe('admins: managing reactions', () => {
	test.beforeEach(async ({ page }) => {
		const [first, second] = mainThread().pids;
		await react('trooper1', first, 'Love');
		await react('trooper2', first, 'Love');
		await react('trooper3', first, 'Like');
		await react('trooper1', second, 'Haha');
		await loginToAdminCp(page);
	});

	test('the list, adding, and the options menu', async ({ page }) => {
		await page.goto('/admin/index.php?module=config');
		const menuItem = page
			.locator('#left_menu a, .left_menu a')
			.filter({ hasText: /^Reactions$/ })
			.first();
		await ring(menuItem);
		await shot(page.locator('body'), 'admins/menu', { minHeight: 400 });

		await gotoReactionsAdmin(page);
		await shot(content(page), 'admins/reactions-list');

		await gotoReactionsAdmin(page, '&action=add');
		await page.locator('#name').fill('Fire');
		await page.locator('#image').setInputFiles({
			name: 'fire.png',
			mimeType: 'image/png',
			buffer: await emojiPng(page, '🔥'),
		});
		await ring(page.locator('#name'), page.locator('#image'));
		await shot(content(page), 'admins/add-reaction', { crop: false });
		await page.locator('#reaction_form input[type="submit"]').click();
		await expect(page.locator('#flash_message')).toHaveText('The reaction has been added.');

		await page.locator(`#reaction_${rid('Angry')}`).click();
		const deactivate = page.locator(`#reaction_${rid('Angry')}_popup a`, { hasText: 'Deactivate' });
		await ring(deactivate);
		await shot(content(page), 'admins/options-menu', { minHeight: 360 });
	});

	test('ordering, and deleting', async ({ page }) => {
		await gotoReactionsAdmin(page);
		await ring(
			page.locator(`#disporder_${rid('Like')}`),
			page.getByRole('button', { name: 'Save Order' })
		);
		await shot(content(page), 'admins/order', { crop: false });

		await gotoReactionsAdmin(page, `&action=delete&rid=${rid('Love')}`);
		await shot(page.locator('.confirm_action'), 'admins/delete-confirm');
	});

	test('the settings', async ({ page }) => {
		await page.goto('/admin/index.php?module=config-settings&action=change&search=reactions');
		await shot(content(page), 'admins/settings');
	});

	test('the plugins page', async ({ page }) => {
		await page.goto('/admin/index.php?module=config-plugins');
		const row = page.locator('tr', { has: page.locator('a[href*="plugin=reactions"]') }).first();
		await ring(
			row.locator('a[href*="plugin=reactions"][href*="action=deactivate"]:not([href*="uninstall"])')
		);
		await shot(content(page), 'webmasters/plugins-page', { include: [row] });
	});
});
