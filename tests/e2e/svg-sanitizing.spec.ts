import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '../helpers/fixtures';
import { gotoReactionsAdmin, loginAs, loginToAdminCp } from '../helpers/auth';
import { FORUM_DIR } from '../helpers/config';
import { runPhp } from '../helpers/container';
import { getReactionByName, mainThread, react, uploadedImages } from '../helpers/db';
import { bar, openThread } from '../helpers/reactions';

/**
 * Uploaded SVGs are rebuilt from what is safe in them (reactions_sanitize_svg()). These run
 * the sanitizer itself over the ways an SVG can carry script, then put one through the
 * Admin CP and open it the way an attacker would want it opened: directly.
 */

const SVG_NS = 'xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"';

/** What reactions_sanitize_svg() makes of an SVG: the result, or null if it refused it. */
async function sanitize(svg: string): Promise<{ svg: string | null; removed: number }> {
	const encoded = Buffer.from(svg).toString('base64');
	const output = await runPhp(`
require_once MYBB_ROOT.'inc/plugins/reactions/inc/reactions_upload.php';
$removed = 0;
$result = reactions_sanitize_svg(base64_decode('${encoded}'), $removed);
echo json_encode(array('svg' => $result === false ? null : $result, 'removed' => $removed));
`);
	return JSON.parse(output);
}

/** A sanitized SVG with everything that could run, fetch or embed searched for. */
function expectInert(svg: string | null): void {
	expect(svg).not.toBeNull();
	const text = svg!.toLowerCase().replace(/\s+/g, '');
	for (const forbidden of [
		'<script',
		'javascript:',
		'vbscript:',
		'data:',
		'<foreignobject',
		'<iframe',
		'<a',
		'<image',
		'@import',
		'http://evil',
	]) {
		expect(text, forbidden).not.toContain(forbidden);
	}
	// No event handler of any kind survives, on any element.
	expect(svg).not.toMatch(/\son[a-z]+\s*=/i);
}

test.describe('sanitizing uploaded SVGs', () => {
	test('a clean SVG comes through unchanged in substance', async () => {
		const clean = `<svg ${SVG_NS} viewBox="0 0 36 36"><defs><linearGradient id="g"><stop offset="0" stop-color="#f00"/></linearGradient></defs><circle cx="18" cy="18" r="16" fill="url(#g)" style="stroke: #000; stroke-width: 1"/><use xlink:href="#g"/><path d="M1 1L35 35"/></svg>`;

		const { svg, removed } = await sanitize(clean);

		expect(removed).toBe(0);
		expect(svg).toContain('<circle cx="18" cy="18" r="16" fill="url(#g)"');
		expect(svg).toContain('style="stroke: #000; stroke-width: 1"');
		expect(svg).toContain('xlink:href="#g"');
		expect(svg).toContain('<path d="M1 1L35 35"/>');
		expect(svg).toContain('<linearGradient id="g">');
	});

	const attacks: Record<string, string> = {
		'a script element': `<svg ${SVG_NS}><script>alert(1)</script><circle r="5"/></svg>`,
		'a script in CDATA': `<svg ${SVG_NS}><script><![CDATA[alert(1)]]></script><circle r="5"/></svg>`,
		'a script in the XHTML namespace': `<svg ${SVG_NS}><html:script xmlns:html="http://www.w3.org/1999/xhtml">alert(1)</html:script><circle r="5"/></svg>`,
		'an upper-case SCRIPT': `<svg ${SVG_NS}><SCRIPT>alert(1)</SCRIPT><circle r="5"/></svg>`,
		'an onload on the root': `<svg ${SVG_NS} onload="alert(1)"><circle r="5"/></svg>`,
		'an upper-case ONLOAD': `<svg ${SVG_NS} ONLOAD="alert(1)"><circle r="5"/></svg>`,
		'event handlers on shapes': `<svg ${SVG_NS}><circle r="5" onclick="alert(1)" onmouseover="alert(2)" onbegin="alert(3)"/></svg>`,
		'a link to javascript:': `<svg ${SVG_NS}><a href="javascript:alert(1)"><circle r="5"/></a><circle r="6"/></svg>`,
		'an xlink:href to javascript: with entities': `<svg ${SVG_NS}><use xlink:href="jav&#x09;ascript:alert(1)"/><circle r="5"/></svg>`,
		'a foreignObject with HTML': `<svg ${SVG_NS}><foreignObject><iframe xmlns="http://www.w3.org/1999/xhtml" src="javascript:alert(1)"></iframe><img xmlns="http://www.w3.org/1999/xhtml" src="x" onerror="alert(1)"/></foreignObject><circle r="5"/></svg>`,
		'an animation that rewrites a link': `<svg ${SVG_NS}><set attributeName="href" to="javascript:alert(1)"/><animate attributeName="xlink:href" values="javascript:alert(1)"/><animate attributeName="onclick" to="alert(1)"/><circle r="5"/></svg>`,
		'a use pointing at another file': `<svg ${SVG_NS}><use href="http://evil.example/sprite.svg#x"/><use xlink:href="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=#x"/><circle r="5"/></svg>`,
		'an image element': `<svg ${SVG_NS}><image href="http://evil.example/x.png"/><circle r="5"/></svg>`,
		'a style that imports or fetches': `<svg ${SVG_NS}><style>@import url(http://evil.example/x.css); circle { fill: url(http://evil.example/p) }</style><circle r="5" style="background: url(javascript:alert(1))"/></svg>`,
		'a style split between text and CDATA': `<svg ${SVG_NS}><style>a{b:url(java<![CDATA[script:alert(1))}]]></style><circle r="5"/></svg>`,
		'a fill that fetches from elsewhere': `<svg ${SVG_NS}><circle r="5" fill="url(http://evil.example/#p)"/></svg>`,
		'an xml-stylesheet instruction': `<?xml-stylesheet href="http://evil.example/x.xsl" type="text/xsl"?><svg ${SVG_NS}><circle r="5"/></svg>`,
		'an iframe and an embed': `<svg ${SVG_NS}><iframe src="javascript:alert(1)"/><embed src="javascript:alert(1)"/><circle r="5"/></svg>`,
	};

	for (const [name, attack] of Object.entries(attacks)) {
		test(`strips ${name}`, async () => {
			const { svg, removed } = await sanitize(attack);

			expectInert(svg);
			expect(removed).toBeGreaterThan(0);
			// The drawing itself is kept.
			expect(svg).toMatch(/<circle r="[56]"/);
		});
	}

	test('refuses files that are not SVGs, or that declare a DOCTYPE', async () => {
		const refused = [
			'',
			'not xml at all',
			'<svg><circle r="5"/></svg>', // no SVG namespace
			`<html ${SVG_NS}><body/></html>`,
			`<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;">]><svg ${SVG_NS}><text>&b;</text></svg>`,
			`<!DOCTYPE svg SYSTEM "file:///etc/passwd"><svg ${SVG_NS}/>`,
			`<svg ${SVG_NS}><circle r="5"></svg>`, // malformed
		];
		for (const svg of refused) {
			expect((await sanitize(svg)).svg, svg).toBeNull();
		}
	});

	test('keeps the drawing elements real icons use', async () => {
		// Shaped like an export from a vector editor: editor namespaces, a title, filters.
		const exported = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Generator: an editor -->
<svg ${SVG_NS} xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" viewBox="0 0 36 36" inkscape:version="1.3">
  <title>Fire</title>
  <defs>
    <radialGradient id="r"><stop offset="0" stop-color="#ff0"/><stop offset="1" stop-color="#f60"/></radialGradient>
    <filter id="f"><feGaussianBlur stdDeviation="1"/><feOffset dx="1"/></filter>
    <clipPath id="c"><rect width="36" height="36"/></clipPath>
  </defs>
  <g clip-path="url(#c)" filter="url(#f)">
    <path d="M18 2C10 12 8 20 18 34C28 20 26 12 18 2Z" fill="url(#r)"/>
    <animateTransform attributeName="transform" type="scale" values="1;1.05;1" dur="1s" repeatCount="indefinite"/>
  </g>
</svg>`;

		const { svg, removed } = await sanitize(exported);

		// The comment and the editor's attribute.
		expect(removed).toBe(2);
		expect(svg).not.toContain('inkscape:version');
		for (const kept of [
			'<title>Fire</title>',
			'<radialGradient id="r">',
			'<feGaussianBlur',
			'clip-path="url(#c)"',
			'filter="url(#f)"',
			'<animateTransform',
		]) {
			expect(svg, kept).toContain(kept);
		}
	});
});

test.describe('uploading an SVG reaction', () => {
	const hostile = Buffer.from(
		`<svg ${SVG_NS} viewBox="0 0 36 36" onload="alert('onload')">` +
			`<script>alert('script')</script>` +
			`<circle cx="18" cy="18" r="16" fill="#f60"/>` +
			`<a href="javascript:alert('link')"><rect width="36" height="36" fill-opacity="0"/></a>` +
			`</svg>`
	);

	test('is stored with its scripts removed, says so, and runs nothing when opened directly', async ({
		page,
	}) => {
		await loginToAdminCp(page);
		await gotoReactionsAdmin(page, '&action=add');
		await page.locator('#name').fill('Fire');
		await page
			.locator('#image')
			.setInputFiles({ name: 'fire.svg', mimeType: 'image/svg+xml', buffer: hostile });
		await page.locator('#reaction_form input[type="submit"]').click();

		await expect(page.locator('#flash_message')).toHaveText(
			'The reaction has been added. Scripts, links and other active content were removed from its SVG image, which is safe to show.'
		);

		const fire = (await getReactionByName('Fire'))!;
		expect(String(fire.image)).toMatch(/^uploads\/reactions\/r\d+_[A-Za-z0-9]{8}\.svg$/);
		const stored = fs.readFileSync(path.join(FORUM_DIR, String(fire.image)), 'utf8');
		expectInert(stored);
		expect(stored).toContain('<circle cx="18" cy="18" r="16" fill="#f60"/>');

		// Opened on its own, as a document - which is when an SVG's script would run.
		const dialogs: string[] = [];
		page.on('dialog', async (dialog) => {
			dialogs.push(dialog.message());
			await dialog.dismiss();
		});
		const response = await page.goto(`/${fire.image}`);
		expect(response?.status()).toBe(200);
		expect(response?.headers()['content-type']).toContain('image/svg+xml');
		await page.locator('svg circle').click({ force: true });
		await page.waitForTimeout(500);
		expect(dialogs).toEqual([]);

		// And members see and can pick it like any other reaction.
		await react('trooper2', mainThread().pids[0], Number(fire.rid));
		await loginAs(page, 'trooper1');
		await openThread(page);
		await expect(
			bar(page, mainThread().pids[0]).locator('.reactions-picker-item[aria-label="Fire"] img')
		).toHaveAttribute('src', new RegExp(`${String(fire.image)}$`));
	});

	test('a clean SVG is stored without the warning', async ({ page }) => {
		await loginToAdminCp(page);
		await gotoReactionsAdmin(page, '&action=add');
		await page.locator('#name').fill('Dot');
		await page.locator('#image').setInputFiles({
			name: 'dot.svg',
			mimeType: 'image/svg+xml',
			buffer: Buffer.from(`<svg ${SVG_NS} viewBox="0 0 2 2"><circle cx="1" cy="1" r="1"/></svg>`),
		});
		await page.locator('#reaction_form input[type="submit"]').click();

		await expect(page.locator('#flash_message')).toHaveText('The reaction has been added.');
	});

	test('a file that is not really an SVG is refused, and nothing is stored', async ({ page }) => {
		await loginToAdminCp(page);
		await gotoReactionsAdmin(page, '&action=add');
		await page.locator('#name').fill('Fire');
		await page.locator('#image').setInputFiles({
			name: 'fire.svg',
			mimeType: 'image/svg+xml',
			buffer: Buffer.from('<?php echo "not an svg"; ?>'),
		});
		await page.locator('#reaction_form input[type="submit"]').click();

		await expect(page.locator('.error')).toContainText(
			'That file is not an SVG image the forum can read.'
		);
		expect(await getReactionByName('Fire')).toBeNull();
		expect(uploadedImages()).toEqual([]);
	});

	test('replacing an image with a hostile SVG cleans it too', async ({ page }) => {
		await loginToAdminCp(page);
		const wow = (await getReactionByName('Wow'))!;
		await gotoReactionsAdmin(page, `&action=edit&rid=${wow.rid}`);
		await page
			.locator('#image')
			.setInputFiles({ name: 'wow.svg', mimeType: 'image/svg+xml', buffer: hostile });
		await page.locator('#reaction_form input[type="submit"]').click();

		await expect(page.locator('#flash_message')).toContainText('were removed from its SVG image');
		const image = String((await getReactionByName('Wow'))!.image);
		expectInert(fs.readFileSync(path.join(FORUM_DIR, image), 'utf8'));
	});
});
