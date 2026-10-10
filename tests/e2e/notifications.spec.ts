import { test, expect } from '../helpers/fixtures';
import { loginAs } from '../helpers/auth';
import { withSettings } from '../helpers/settings';
import {
	countAllPrivateMessages,
	getPrivateMessages,
	getUser,
	mainThread,
	setUserColumn,
	uid,
} from '../helpers/db';
import { clickReact, openThread, pickReaction } from '../helpers/reactions';

const opening = () => mainThread().pids[0];

test.describe('telling authors about reactions', () => {
	test('the first reaction to a post sends its author a PM from the member who reacted', async ({
		page,
	}) => {
		await loginAs(page, 'trooper1');
		await openThread(page);

		await pickReaction(page, opening(), 'Love');

		const messages = await getPrivateMessages('author');
		expect(messages).toHaveLength(1);
		expect(messages[0].subject).toBe('trooper1 reacted to your post');
		expect(Number(messages[0].fromid)).toBe(uid('trooper1'));
		expect(messages[0].message).toContain('with: Love');
		expect(messages[0].message).toContain('Reactions Test Thread');
		// Plain ampersands: the link lives in MyCode, not in an HTML attribute.
		expect(messages[0].message).toContain(
			`/showthread.php?tid=${mainThread().tid}&pid=${opening()}#pid${opening()}`
		);
		expect(messages[0].message).not.toContain('&amp;');

		// No copy in the reacting member's Sent Items: they did not write it.
		expect(await countAllPrivateMessages()).toBe(1);
	});

	test('the author can follow the PM back to the post', async ({ page }) => {
		await loginAs(page, 'trooper1');
		await openThread(page);
		await pickReaction(page, opening(), 'Wow');

		await loginAs(page, 'author');
		const [message] = await getPrivateMessages('author');
		await page.goto(`/private.php?action=read&pmid=${message.pmid}`);
		const link = page.getByRole('link', { name: 'your post in Reactions Test Thread' });
		const href = (await link.getAttribute('href'))!;

		// MyCode links open in a new tab, so the link is followed rather than clicked.
		await page.goto(href);
		await expect(page).toHaveURL(new RegExp(`pid=${opening()}#pid${opening()}$`));
		await expect(page.locator(`#post_${opening()}`)).toBeVisible();
	});

	test('switching, or taking a reaction back and adding it again, does not send another', async ({
		page,
	}) => {
		await loginAs(page, 'trooper1');
		await openThread(page);

		await pickReaction(page, opening(), 'Love');
		await pickReaction(page, opening(), 'Haha');
		await clickReact(page, opening());
		await clickReact(page, opening());

		expect(await getPrivateMessages('author')).toHaveLength(1);
	});

	test('each member, and each post, is a PM of its own', async ({ page }) => {
		const [first, second] = mainThread().pids;
		await loginAs(page, 'trooper1');
		await openThread(page);
		await clickReact(page, first);
		await clickReact(page, second);

		await loginAs(page, 'trooper2');
		await openThread(page);
		await clickReact(page, first);

		expect(await getPrivateMessages('author')).toHaveLength(3);
	});

	test('nobody is told about their own reaction', async ({ page }) => {
		await loginAs(page, 'author');
		await openThread(page);

		await clickReact(page, opening());

		expect(await countAllPrivateMessages()).toBe(0);
	});

	test('nothing is sent when the board has turned notifications off', async ({ page }) => {
		const restore = await withSettings({ reactions_notify_pm: '0' });
		try {
			await loginAs(page, 'trooper1');
			await openThread(page);
			await clickReact(page, opening());

			expect(await countAllPrivateMessages()).toBe(0);
		} finally {
			await restore();
		}
	});

	test('nothing is sent to an author who has turned them off', async ({ page }) => {
		await setUserColumn('author', 'reactions_notify', 0);
		await loginAs(page, 'trooper1');
		await openThread(page);

		await clickReact(page, opening());

		expect(await countAllPrivateMessages()).toBe(0);
	});

	test('nothing is sent to an author who is ignoring the member, or has PMs off', async ({
		page,
	}) => {
		// The users row is not part of what each test resets, so it is put back whatever
		// happens.
		try {
			await setUserColumn('author', 'ignorelist', String(uid('trooper1')));
			await loginAs(page, 'trooper1');
			await openThread(page);
			await clickReact(page, opening());
			expect(await countAllPrivateMessages()).toBe(0);

			await setUserColumn('author', 'ignorelist', '');
			await setUserColumn('author', 'receivepms', 0);
			await loginAs(page, 'trooper2');
			await openThread(page);
			await clickReact(page, opening());
			expect(await countAllPrivateMessages()).toBe(0);
		} finally {
			await setUserColumn('author', 'ignorelist', '');
			await setUserColumn('author', 'receivepms', 1);
		}
	});

	test('the User CP has the opt-out, and it saves', async ({ page }) => {
		await loginAs(page, 'author');
		await page.goto('/usercp.php?action=options');

		const checkbox = page.locator('#reactions_notify');
		await expect(checkbox).toBeChecked();
		await expect(page.locator('label[for="reactions_notify"]')).toHaveText(
			'Send me a private message when someone reacts to my posts'
		);

		await checkbox.uncheck();
		await page.locator('form[action="usercp.php"] [type="submit"][name="regsubmit"]').click();
		await expect.poll(async () => Number((await getUser('author')).reactions_notify)).toBe(0);

		await page.goto('/usercp.php?action=options');
		await expect(checkbox).not.toBeChecked();
		await checkbox.check();
		await page.locator('form[action="usercp.php"] [type="submit"][name="regsubmit"]').click();
		await expect.poll(async () => Number((await getUser('author')).reactions_notify)).toBe(1);
	});

	test('saving the options page without the opt-out on it leaves the preference alone', async ({
		page,
	}) => {
		// The provisioned opt-out member, whose preference is off; a form that never showed
		// the checkbox must not read its absence as "off", or as "on".
		await loginAs(page, 'optout');
		await page.goto('/usercp.php?action=options');
		const key = await page.locator('input[name="my_post_key"]').first().getAttribute('value');

		await page.request.post('/usercp.php', {
			form: { action: 'do_options', my_post_key: key ?? '', reactions_notify: '1' },
		});

		expect(Number((await getUser('optout')).reactions_notify)).toBe(0);
	});
});
