import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { RowDataPacket } from 'mysql2/promise';
import { test, expect } from '../helpers/fixtures';
import { loginAs, loginToAdminCp } from '../helpers/auth';
import { REPO_ROOT } from '../helpers/config';
import { runPhp } from '../helpers/container';
import { mainThread, query, queryOne, react, T, uid } from '../helpers/db';
import { bar, openThread } from '../helpers/reactions';

const opening = () => mainThread().pids[0];

/** Every template the plugin ships, as reactions/templates/ has them. */
const SHIPPED_TEMPLATES = fs
	.readdirSync(path.join(REPO_ROOT, 'plugin/inc/plugins/reactions/templates'))
	.filter((name) => name.endsWith('.html'))
	.map((name) => name.replace(/\.html$/, ''))
	.sort();

async function tableExists(name: string): Promise<boolean> {
	const rows = await query<RowDataPacket>(
		'SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?',
		[T(name)]
	);
	return rows.length > 0;
}

async function columnExists(table: string, column: string): Promise<boolean> {
	const rows = await query<RowDataPacket>(
		`SELECT 1 FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
		[T(table), column]
	);
	return rows.length > 0;
}

/**
 * Put the plugin back installed and active, the way provisioning leaves it, whatever a
 * test did to it. A test that fails between uninstalling and reinstalling would otherwise
 * leave every test after it running against a board with no plugin.
 */
async function ensureInstalledAndActive(): Promise<void> {
	await runPhp(`
require_once MYBB_ROOT.'inc/plugins/reactions.php';
if(!reactions_is_installed()) { reactions_install(); }
reactions_activate();
$plugins_cache = $cache->read('plugins');
$active = isset($plugins_cache['active']) ? $plugins_cache['active'] : array();
$active['reactions'] = 'reactions';
$cache->update('plugins', array('active' => $active));
echo "ok";
`);
	// A fresh install gives everybody the column's default; the opt-out member's is put
	// back by the next test's reset, from the copy global setup took.
}

/** The custom (theme) copies of a template that carry a piece of text. */
async function templatesContaining(title: string, text: string): Promise<number> {
	const row = await queryOne<RowDataPacket>(
		`SELECT COUNT(*) AS total FROM ${T('templates')} WHERE title = ? AND sid > 0 AND template LIKE ?`,
		[title, `%${text}%`]
	);
	return Number(row?.total ?? 0);
}

/** Click one of the Reactions row's links on the Admin CP's Plugins page. */
async function pluginAction(page: Page, action: 'activate' | 'deactivate' | 'uninstall') {
	await page.goto('/admin/index.php?module=config-plugins');
	const selector =
		action === 'uninstall'
			? 'a[href*="plugin=reactions"][href*="uninstall=1"]'
			: `a[href*="plugin=reactions"][href*="action=${action}"]:not([href*="uninstall"])`;
	await page.locator(selector).click();
	await expect(page.locator('#flash_message')).toBeVisible();
}

test.describe('installing and removing the plugin', () => {
	test.afterEach(async () => {
		await ensureInstalledAndActive();
	});

	test('as provisioned: tables, column, settings, templates, stylesheet and the six defaults', async () => {
		for (const table of [
			'reactions',
			'reactions_post',
			'reactions_notified',
			'reactions_schema_upgrades',
		]) {
			expect(await tableExists(table), table).toBe(true);
		}
		expect(await columnExists('users', 'reactions_notify')).toBe(true);

		const settings = await query<RowDataPacket>(
			`SELECT name, value FROM ${T('settings')} WHERE name LIKE 'reactions\\_%' ORDER BY disporder`
		);
		expect(settings.map((s) => [s.name, s.value])).toEqual([
			['reactions_notify_pm', '1'],
			['reactions_summary_icons', '3'],
			['reactions_max_upload_kb', '256'],
		]);

		const templates = await query<RowDataPacket>(
			`SELECT title FROM ${T('templates')} WHERE sid = -2 AND title LIKE 'reactions\\_%' ORDER BY title`
		);
		expect(templates.map((t) => t.title)).toEqual(SHIPPED_TEMPLATES);

		const sheet = await queryOne<RowDataPacket>(
			`SELECT attachedto FROM ${T('themestylesheets')} WHERE name = 'reactions.css' AND tid = 1`
		);
		expect(sheet?.attachedto).toBe('showthread.php|misc.php');

		const reactions = await query<RowDataPacket>(
			`SELECT name, image, active FROM ${T('reactions')} ORDER BY disporder`
		);
		expect(reactions.map((r) => r.name)).toEqual(['Like', 'Love', 'Haha', 'Wow', 'Sad', 'Angry']);
		for (const reaction of reactions) {
			expect(fs.existsSync(path.join(REPO_ROOT, 'plugin', String(reaction.image)))).toBe(true);
		}

		// The garrison theme's postbit, and its PM options, carry the template edits.
		expect(await templatesContaining('postbit', "{$post['reactions']}")).toBeGreaterThan(0);
		expect(
			await templatesContaining('usercp_options_pms', '{$reactions_usercp_option}')
		).toBeGreaterThan(0);
	});

	test('the stylesheet is on threads and the who-reacted page, and not elsewhere', async ({
		page,
	}) => {
		await loginAs(page, 'trooper1');
		await page.goto(`/showthread.php?tid=${mainThread().tid}`);
		await expect(page.locator('link[href*="reactions.css"]')).toHaveCount(1);

		await page.goto(`/misc.php?action=reactions_who&pid=${opening()}`);
		await expect(page.locator('link[href*="reactions.css"]')).toHaveCount(1);

		await page.goto('/index.php');
		await expect(page.locator('link[href*="reactions.css"]')).toHaveCount(0);
		await expect(page.locator('script[src*="reactions.js"]')).toHaveCount(0);
	});

	test('deactivating takes the bar out of posts and keeps everything else; activating puts it back', async ({
		page,
	}) => {
		await react('trooper2', opening(), 'Love');
		await loginToAdminCp(page);

		await pluginAction(page, 'deactivate');
		expect(await templatesContaining('postbit', "{$post['reactions']}")).toBe(0);
		expect(await templatesContaining('postbit_classic', "{$post['reactions']}")).toBe(0);
		expect(await templatesContaining('usercp_options_pms', '{$reactions_usercp_option}')).toBe(0);
		expect(await tableExists('reactions_post')).toBe(true);

		await loginAs(page, 'trooper1');
		await page.goto(`/showthread.php?tid=${mainThread().tid}`);
		await expect(page.locator('.reactions')).toHaveCount(0);
		await page.goto('/usercp.php?action=options');
		await expect(page.locator('#reactions_notify')).toHaveCount(0);

		await loginToAdminCp(page);
		await pluginAction(page, 'activate');
		// Exactly once, however many times it is activated.
		await pluginAction(page, 'deactivate');
		await pluginAction(page, 'activate');

		await loginAs(page, 'trooper1');
		await openThread(page);
		await expect(bar(page, opening())).toHaveCount(1);
		await expect(bar(page, opening()).locator('.reactions-summary')).toContainText('1');
		const postbit = await queryOne<RowDataPacket>(
			`SELECT template FROM ${T('templates')} WHERE title = 'postbit' AND sid > 0 LIMIT 1`
		);
		expect(String(postbit!.template).split("{$post['reactions']}")).toHaveLength(2);
	});

	test('uninstalling removes every trace, and installing again starts from the defaults', async ({
		page,
	}) => {
		await react('trooper2', opening(), 'Love');
		await loginToAdminCp(page);

		await pluginAction(page, 'uninstall');

		for (const table of [
			'reactions',
			'reactions_post',
			'reactions_notified',
			'reactions_schema_upgrades',
		]) {
			expect(await tableExists(table), table).toBe(false);
		}
		expect(await columnExists('users', 'reactions_notify')).toBe(false);
		const leftovers = await queryOne<RowDataPacket>(
			`SELECT
         (SELECT COUNT(*) FROM ${T('settings')} WHERE name LIKE 'reactions\\_%') AS settings,
         (SELECT COUNT(*) FROM ${T('settinggroups')} WHERE name = 'reactions') AS groups_,
         (SELECT COUNT(*) FROM ${T('templates')} WHERE title LIKE 'reactions\\_%') AS templates,
         (SELECT COUNT(*) FROM ${T('templategroups')} WHERE prefix = 'reactions_') AS templategroups,
         (SELECT COUNT(*) FROM ${T('themestylesheets')} WHERE name = 'reactions.css') AS sheets,
         (SELECT COUNT(*) FROM ${T('datacache')} WHERE title = 'reactions') AS cache,
         (SELECT COUNT(*) FROM ${T('templates')} WHERE template LIKE '%{$post[''reactions'']}%') AS edits`
		);
		expect(leftovers).toEqual({
			settings: 0,
			groups_: 0,
			templates: 0,
			templategroups: 0,
			sheets: 0,
			cache: 0,
			edits: 0,
		});

		// The board works without it.
		await loginAs(page, 'trooper1');
		await page.goto(`/showthread.php?tid=${mainThread().tid}`);
		await expect(page.locator(`#post_${opening()}`)).toBeVisible();
		await expect(page.locator('.reactions')).toHaveCount(0);

		await loginToAdminCp(page);
		await pluginAction(page, 'activate');

		const reactions = await query<RowDataPacket>(
			`SELECT name FROM ${T('reactions')} ORDER BY disporder`
		);
		expect(reactions.map((r) => r.name)).toEqual(['Like', 'Love', 'Haha', 'Wow', 'Sad', 'Angry']);
		expect(
			await queryOne<RowDataPacket>(`SELECT COUNT(*) AS total FROM ${T('reactions_post')}`)
		).toEqual({
			total: 0,
		});
		const author = await queryOne<RowDataPacket>(
			`SELECT reactions_notify FROM ${T('users')} WHERE uid = ?`,
			[uid('author')]
		);
		expect(Number(author!.reactions_notify)).toBe(1);

		await loginAs(page, 'trooper1');
		await openThread(page);
		await expect(bar(page, opening()).locator('.reactions-button')).toHaveText('Like');
	});

	test("the plugin carries its own copy of the licence and notice, matching the repository's", async () => {
		for (const file of ['LICENSE', 'NOTICE']) {
			expect(
				fs.readFileSync(path.join(REPO_ROOT, 'plugin/inc/plugins/reactions', file), 'utf8')
			).toBe(fs.readFileSync(path.join(REPO_ROOT, file), 'utf8'));
		}
	});
});
