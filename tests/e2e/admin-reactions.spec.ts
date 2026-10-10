import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from '../helpers/fixtures';
import {
	followAdminActionLink,
	gotoReactionsAdmin,
	loginAs,
	loginToAdminCp,
} from '../helpers/auth';
import { FORUM_DIR } from '../helpers/config';
import {
	adminLog,
	countReactions,
	getReaction,
	getReactionByName,
	mainThread,
	react,
	reactionOf,
	rid,
	uploadedImages,
} from '../helpers/db';
import { withSettings } from '../helpers/settings';
import { bigPng, fakePng, fakeSvg, gif, png, Upload } from '../helpers/images';
import { bar, openThread, picker, reactButton, summaryIcons } from '../helpers/reactions';

const opening = () => mainThread().pids[0];

/** Fill in and submit the add or edit form. */
async function submitForm(
	page: Page,
	values: { name?: string; image?: Upload; disporder?: number; active?: boolean }
): Promise<void> {
	if (values.name !== undefined) {
		await page.locator('#name').fill(values.name);
	}
	if (values.image) {
		await page.locator('#image').setInputFiles(values.image);
	}
	if (values.disporder !== undefined) {
		await page.locator('#disporder').fill(String(values.disporder));
	}
	if (values.active !== undefined) {
		await page.locator(`input[name="active"][value="${values.active ? 1 : 0}"]`).check();
	}
	await page.locator('#reaction_form input[type="submit"]').click();
}

/** The picker's reactions on the opening post, as trooper1 sees them. */
async function pickerNames(page: Page): Promise<string[]> {
	await loginAs(page, 'trooper1');
	await openThread(page);
	return picker(page, opening())
		.locator('.reactions-picker-item')
		.evaluateAll((items) => items.map((item) => item.getAttribute('aria-label') ?? ''));
}

const imageOnDisk = (image: string) => path.join(FORUM_DIR, image);

test.describe('Admin CP: Configuration -> Reactions', () => {
	test.beforeEach(async ({ page }) => {
		await loginToAdminCp(page);
	});

	test('is in the Configuration menu and lists the reactions with how often each is used', async ({
		page,
	}) => {
		await react('trooper1', opening(), 'Love');
		await react('trooper2', opening(), 'Love');
		await react('trooper3', opening(), 'Wow');

		await page.goto('/admin/index.php?module=config');
		await page
			.locator('#left_menu a, .left_menu a, a')
			.filter({ hasText: /^Reactions$/ })
			.first()
			.click();
		await expect(page).toHaveURL(/module=config-reactions$/);

		const rows = page.locator('tr[id^="reaction_row_"]');
		await expect(rows).toHaveCount(6);
		const names = await rows.locator('td:nth-child(2) strong').allTextContents();
		expect(names).toEqual(['Like', 'Love', 'Haha', 'Wow', 'Sad', 'Angry']);

		await expect(page.locator(`#reaction_row_${rid('Like')}`)).toContainText('(default)');
		await expect(page.locator(`#reaction_row_${rid('Love')} td:nth-child(4)`)).toHaveText('2');
		await expect(page.locator(`#reaction_row_${rid('Wow')} td:nth-child(4)`)).toHaveText('1');
		await expect(page.locator(`#reaction_row_${rid('Sad')} td:nth-child(4)`)).toHaveText('0');
	});

	test('adds a reaction with an uploaded image, which members can then pick', async ({ page }) => {
		await gotoReactionsAdmin(page, '&action=add');
		await submitForm(page, { name: 'Fire', image: png() });

		await expect(page.locator('#flash_message')).toHaveText('The reaction has been added.');
		const added = await getReactionByName('Fire');
		expect(added).not.toBeNull();
		expect(String(added!.image)).toMatch(
			new RegExp(`^uploads/reactions/r${added!.rid}_[A-Za-z0-9]{8}\\.png$`)
		);
		expect(fs.existsSync(imageOnDisk(String(added!.image)))).toBe(true);
		// With no order given it goes after the others.
		expect(Number(added!.disporder)).toBe(7);

		const log = await adminLog();
		expect(log[0]).toMatchObject({ module: 'config-reactions', action: 'add' });

		expect(await pickerNames(page)).toEqual([
			'Like',
			'Love',
			'Haha',
			'Wow',
			'Sad',
			'Angry',
			'Fire',
		]);
		const image = bar(page, opening()).locator('.reactions-picker-item[aria-label="Fire"] img');
		await expect(image).toHaveAttribute('src', new RegExp(`/${String(added!.image)}$`));
		// The uploaded file is really served.
		const served = await page.request.get(String(await image.getAttribute('src')));
		expect(served.status()).toBe(200);
		expect(served.headers()['content-type']).toContain('image/png');
	});

	test('takes a GIF as well as a PNG', async ({ page }) => {
		await gotoReactionsAdmin(page, '&action=add');
		await submitForm(page, { name: 'Sparkle', image: gif() });

		await expect(page.locator('#flash_message')).toHaveText('The reaction has been added.');
		expect(String((await getReactionByName('Sparkle'))!.image)).toMatch(/\.gif$/);
	});

	test('refuses a reaction with no name, or no image', async ({ page }) => {
		await gotoReactionsAdmin(page, '&action=add');
		await submitForm(page, { name: '' });

		await expect(page.locator('.error')).toContainText('Give the reaction a name.');
		await expect(page.locator('.error')).toContainText('Choose an image for the reaction.');
		expect(uploadedImages()).toEqual([]);
	});

	test('refuses a name that is already taken, whatever its case', async ({ page }) => {
		await gotoReactionsAdmin(page, '&action=add');
		await submitForm(page, { name: 'like', image: png() });

		await expect(page.locator('.error')).toContainText(
			'There is already a reaction with that name.'
		);
		expect(uploadedImages()).toEqual([]);
	});

	test('refuses files that are not images, or not the image they claim, and images that are too large', async ({
		page,
	}) => {
		const cases: Array<[Upload, string]> = [
			[fakeSvg(), 'That file is not an SVG image the forum can read.'],
			[fakePng(), 'That file is not a valid image'],
			// A real PNG, named as something else.
			[{ ...png(), name: 'fire.gif' }, 'That file is not a valid image'],
			[{ ...png(), name: 'fire.bmp' }, 'Reaction images must be PNG, GIF, JPEG, WebP or SVG.'],
			[bigPng(300), 'The image is too large. Reaction images can be at most 256 KB.'],
		];

		for (const [image, error] of cases) {
			await gotoReactionsAdmin(page, '&action=add');
			await submitForm(page, { name: 'Fire', image });
			await expect(page.locator('.error'), image.name).toContainText(error);
		}

		expect(await getReactionByName('Fire')).toBeNull();
		expect(uploadedImages()).toEqual([]);
	});

	test('the size limit is a setting', async ({ page }) => {
		const restore = await withSettings({ reactions_max_upload_kb: '1' });
		try {
			await gotoReactionsAdmin(page, '&action=add');
			await expect(page.locator('#reaction_form')).toContainText('up to 1 KB');
			await submitForm(page, { name: 'Fire', image: bigPng(2) });
			await expect(page.locator('.error')).toContainText('can be at most 1 KB');
		} finally {
			await restore();
		}
	});

	test('edits a name and order, keeping the image when no new one is given', async ({ page }) => {
		await react('trooper1', opening(), 'Love');
		await gotoReactionsAdmin(page, `&action=edit&rid=${rid('Love')}`);
		await expect(page.locator('#name')).toHaveValue('Love');
		await expect(page.locator('.reactions-admin-current img')).toHaveAttribute('src', /love\.svg$/);

		await submitForm(page, { name: 'Heart', disporder: 0 });

		await expect(page.locator('#flash_message')).toHaveText('The reaction has been saved.');
		const edited = await getReaction(rid('Love'));
		expect(edited).toMatchObject({
			name: 'Heart',
			image: 'images/reactions/love.svg',
			disporder: 0,
		});

		// Ordered first, it is now the default - and the member's reaction is kept, renamed.
		expect((await pickerNames(page))[0]).toBe('Heart');
		expect(await reactionOf('trooper1', opening())).toBe('Heart');
		await expect(reactButton(page, opening())).toHaveText('Heart');
	});

	test('replacing an uploaded image deletes the old file, but never a bundled one', async ({
		page,
	}) => {
		// A bundled default first: its file belongs to the plugin and stays.
		await gotoReactionsAdmin(page, `&action=edit&rid=${rid('Wow')}`);
		await submitForm(page, { image: png('wow.png') });
		await expect(page.locator('#flash_message')).toHaveText('The reaction has been saved.');
		const first = String((await getReaction(rid('Wow')))!.image);
		expect(first).toMatch(/^uploads\/reactions\//);
		expect(fs.existsSync(path.join(FORUM_DIR, 'images/reactions/wow.svg'))).toBe(true);

		// Then an uploaded one, which goes.
		await gotoReactionsAdmin(page, `&action=edit&rid=${rid('Wow')}`);
		await submitForm(page, { image: gif('wow.gif') });
		const second = String((await getReaction(rid('Wow')))!.image);
		expect(second).toMatch(/\.gif$/);
		expect(fs.existsSync(imageOnDisk(second))).toBe(true);
		expect(fs.existsSync(imageOnDisk(first))).toBe(false);
	});

	test('a bad replacement image leaves the reaction as it was', async ({ page }) => {
		await gotoReactionsAdmin(page, `&action=edit&rid=${rid('Wow')}`);
		await submitForm(page, { name: 'Whoa', image: fakePng() });

		await expect(page.locator('.error')).toContainText('That file is not a valid image');
		expect(await getReaction(rid('Wow'))).toMatchObject({
			name: 'Wow',
			image: 'images/reactions/wow.svg',
		});
	});

	test("deactivating hides a reaction from the picker and from posts, without losing anyone's", async ({
		page,
	}) => {
		await react('trooper1', opening(), 'Haha');
		await react('trooper2', opening(), 'Love');

		await followAdminActionLink(page, `action=deactivate&rid=${rid('Haha')}`);
		expect(Number((await getReaction(rid('Haha')))!.active)).toBe(0);

		expect(await pickerNames(page)).not.toContain('Haha');
		expect(await summaryIcons(page, opening())).toEqual(['Love']);
		await expect(reactButton(page, opening())).toHaveText('Like');
		expect(await countReactions(opening())).toBe(2);

		await loginToAdminCp(page);
		await gotoReactionsAdmin(page);
		await expect(page.locator(`#reaction_row_${rid('Haha')}`)).toContainText('Inactive');

		await followAdminActionLink(page, `action=activate&rid=${rid('Haha')}`);
		await loginAs(page, 'trooper1');
		await openThread(page);
		await expect(reactButton(page, opening())).toHaveText('Haha');
		expect(await summaryIcons(page, opening())).toEqual(['Love', 'Haha']);

		const actions = (await adminLog()).map((entry) => entry.action);
		expect(actions).toEqual(expect.arrayContaining(['activate', 'deactivate']));
	});

	test('activation links without the post key are refused', async ({ page }) => {
		const body = await followAdminActionLink(page, `action=deactivate&rid=${rid('Haha')}`, {
			withKey: false,
		});

		expect(Number((await getReaction(rid('Haha')))!.active)).toBe(1);
		expect(body).not.toContain('The reaction is now inactive.');
	});

	test('saves a new order', async ({ page }) => {
		await gotoReactionsAdmin(page);
		await page.locator(`#disporder_${rid('Angry')}`).fill('0');
		await page.locator(`#disporder_${rid('Like')}`).fill('10');
		await page.getByRole('button', { name: 'Save Order' }).click();

		await expect(page.locator('#flash_message')).toHaveText('The order has been saved.');
		expect(await pickerNames(page)).toEqual(['Angry', 'Love', 'Haha', 'Wow', 'Sad', 'Like']);
		// The first is the default.
		await expect(reactButton(page, opening())).toHaveText('Angry');
	});

	test('deleting asks first, saying how many reactions go with it', async ({ page }) => {
		await react('trooper1', opening(), 'Sad');
		await react('trooper2', mainThread().pids[1], 'Sad');

		await gotoReactionsAdmin(page, `&action=delete&rid=${rid('Sad')}`);
		await expect(page.locator('.confirm_action')).toContainText('It has been used 2 times');

		await page.locator('.confirm_action input[name="no"]').click();
		expect(await getReaction(rid('Sad'))).not.toBeNull();

		await gotoReactionsAdmin(page, `&action=delete&rid=${rid('Sad')}`);
		await page.locator('.confirm_action .button_yes').click();

		await expect(page.locator('#flash_message')).toHaveText('The reaction has been deleted.');
		expect(await getReaction(rid('Sad'))).toBeNull();
		expect(await countReactions(opening())).toBe(0);
		expect(await countReactions(mainThread().pids[1])).toBe(0);
		// The bundled image is the plugin's, and stays.
		expect(fs.existsSync(path.join(FORUM_DIR, 'images/reactions/sad.svg'))).toBe(true);
		expect(await pickerNames(page)).not.toContain('Sad');
	});

	test('deleting a reaction with an uploaded image deletes the image', async ({ page }) => {
		await gotoReactionsAdmin(page, '&action=add');
		await submitForm(page, { name: 'Fire', image: png() });
		const fire = (await getReactionByName('Fire'))!;
		expect(fs.existsSync(imageOnDisk(String(fire.image)))).toBe(true);

		await gotoReactionsAdmin(page, `&action=delete&rid=${fire.rid}`);
		await page.locator('.confirm_action .button_yes').click();

		expect(fs.existsSync(imageOnDisk(String(fire.image)))).toBe(false);
	});

	test('a reaction that does not exist is reported, not edited', async ({ page }) => {
		await gotoReactionsAdmin(page, '&action=edit&rid=99999');

		await expect(page.locator('#flash_message')).toHaveText('That reaction does not exist.');
	});

	test('every change is in the administrator log, worded', async ({ page }) => {
		await gotoReactionsAdmin(page, '&action=add');
		await submitForm(page, { name: 'Fire', image: png() });
		await gotoReactionsAdmin(page);
		await page.getByRole('button', { name: 'Save Order' }).click();

		await page.goto('/admin/index.php?module=tools-adminlog');
		const fire = (await getReactionByName('Fire'))!;
		await expect(page.locator('body')).toContainText(`Added reaction #${fire.rid} (Fire)`);
		await expect(page.locator('body')).toContainText('Reordered the reactions');
	});

	test('with no active reactions, members get no button', async ({ page }) => {
		for (const name of ['Like', 'Love', 'Haha', 'Wow', 'Sad', 'Angry']) {
			await followAdminActionLink(page, `action=deactivate&rid=${rid(name)}`);
		}

		await loginAs(page, 'trooper1');
		await openThread(page);
		await expect(bar(page, opening())).toHaveCount(0);
	});
});
