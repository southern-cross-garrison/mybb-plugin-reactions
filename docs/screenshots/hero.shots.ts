/**
 * The picture at the top of the guide's home page: a post with several reactions and its
 * picker open, and the list of who reacted beside it - the whole plugin at a glance.
 *
 * A single screenshot cannot show both - the list opens over the page and dims the post -
 * so the two are captured on their own and laid out together here, with no rings: the
 * picture is there to show what the plugin looks like, not to point at a control.
 *
 *   pnpm screenshots hero   # from docs/
 */
import { Locator } from '@playwright/test';
import sharp from 'sharp';
import { test, expect } from '../../tests/helpers/fixtures';
import { loginAs } from '../../tests/helpers/auth';
import { mainThread, react } from '../../tests/helpers/db';
import { openPicker, openThread, picker, summary } from '../../tests/helpers/reactions';
import { save } from './annotate';

const opening = () => mainThread().pids[0];

// In device pixels: the shots are taken at 2x (playwright.config.ts).
const MARGIN = 72;
const BACKGROUND = '#e9eef3';
const SHADOW_BLUR = 22;

/** A capture of an element, with its rounded corners cut out of whatever was behind it. */
async function capture(element: Locator, radius: number): Promise<sharp.Sharp> {
	const png = await element.screenshot({ animations: 'disabled', caret: 'hide' });
	const { width, height } = await sharp(png).metadata();
	const mask = Buffer.from(
		`<svg width="${width}" height="${height}"><rect width="${width}" height="${height}" rx="${radius * 2}" /></svg>`
	);
	return sharp(png)
		.ensureAlpha()
		.composite([{ input: mask, blend: 'dest-in' }]);
}

/** A soft shadow for a piece of the given size, to sit under it. */
async function shadow(width: number, height: number, radius: number): Promise<Buffer> {
	const pad = SHADOW_BLUR * 3;
	const svg = Buffer.from(
		`<svg width="${width + pad * 2}" height="${height + pad * 2}">` +
			`<rect x="${pad}" y="${pad}" width="${width}" height="${height}" rx="${radius * 2}" fill="#0b2233" fill-opacity="0.28" />` +
			`</svg>`
	);
	return sharp(svg).blur(SHADOW_BLUR).png().toBuffer();
}

test('the home page picture', async ({ page }) => {
	// Five members' reactions, one of them the viewer's own, so the summary pictures
	// several and reads "You and 4 others", and the button shows the viewer's.
	await react('trooper1', opening(), 'Love');
	await react('trooper2', opening(), 'Love');
	await react('trooper3', opening(), 'Like');
	await react('staff', opening(), 'Haha');
	await react('author', opening(), 'Wow');

	// Narrower than the guide's other pictures, so the post and the list sit together.
	await page.setViewportSize({ width: 760, height: 900 });
	await loginAs(page, 'trooper1');
	await openThread(page);

	await openPicker(page, opening());
	// Off the picker, so no reaction is shown zoomed as if pointed at.
	await page.mouse.move(5, 5);
	const card = page.locator(`#post_${opening()} .card`);
	await card.scrollIntoViewIfNeeded();
	const post = await capture(card, 4);

	await page.locator('body').click({ position: { x: 5, y: 5 } });
	await expect(picker(page, opening())).toBeHidden();
	await summary(page, opening()).click();
	const modal = page.locator('.blocker .reactions-who-modal');
	await expect(modal.locator('.reactions-who-row')).toHaveCount(5);
	await expect(page.locator('.blocker')).toHaveCSS('opacity', '1');
	await expect(modal).toHaveCSS('opacity', '1');
	await page.mouse.move(5, 5);
	const list = await capture(modal, 8);

	const [postPng, listPng] = await Promise.all([post.png().toBuffer(), list.png().toBuffer()]);
	const p = await sharp(postPng).metadata();
	const l = await sharp(listPng).metadata();
	const pw = p.width!;
	const ph = p.height!;
	const lw = l.width!;
	const lh = l.height!;

	// The post at the top left, and the list below it to the right, as if just opened from
	// the summary. It overlaps only the post's footer, so the reactions bar - the summary
	// and the button under the open picker - stays in sight.
	const footer = await page
		.locator(`#post_${opening()} .card-footer`)
		.evaluate((el) => el.getBoundingClientRect().height * 2);
	const postAt = { left: MARGIN, top: MARGIN };
	const listAt = {
		left: MARGIN + Math.round(pw * 0.42),
		top: MARGIN + ph - Math.round(footer * 0.6),
	};
	const width = Math.max(postAt.left + pw, listAt.left + lw) + MARGIN;
	const height = Math.max(postAt.top + ph, listAt.top + lh) + MARGIN;
	const pad = SHADOW_BLUR * 3;

	const image = await sharp({
		create: { width, height, channels: 4, background: BACKGROUND },
	})
		.composite([
			{ input: await shadow(pw, ph, 4), left: postAt.left - pad, top: postAt.top - pad + 6 },
			{ input: postPng, ...postAt },
			{ input: await shadow(lw, lh, 8), left: listAt.left - pad, top: listAt.top - pad + 10 },
			{ input: listPng, ...listAt },
		])
		.png()
		.toBuffer();

	await save('hero', image);
});
