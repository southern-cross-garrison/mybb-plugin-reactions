import { test, expect } from '../helpers/fixtures';
import { loginAs } from '../helpers/auth';
import { countReactions, mainThread, react, reactionOf } from '../helpers/db';
import {
	bar,
	clickReact,
	openThread,
	pickReaction,
	reactButton,
	summary,
	summaryIcons,
} from '../helpers/reactions';

const opening = () => mainThread().pids[0];

test.describe('reacting to a post', () => {
	test.beforeEach(async ({ page }) => {
		await loginAs(page, 'trooper1');
	});

	test('a post nobody has reacted to offers the default reaction and shows no summary', async ({
		page,
	}) => {
		await openThread(page);

		await expect(reactButton(page, opening())).toHaveText('Like');
		await expect(reactButton(page, opening())).toHaveAttribute('aria-pressed', 'false');
		await expect(summary(page, opening())).toHaveCount(0);
	});

	test('clicking the button adds the default reaction, and clicking again takes it back', async ({
		page,
	}) => {
		await openThread(page);

		await clickReact(page, opening());
		expect(await reactionOf('trooper1', opening())).toBe('Like');
		await expect(reactButton(page, opening())).toHaveAttribute('aria-pressed', 'true');
		await expect(reactButton(page, opening())).toHaveClass(/reactions-button--active/);
		// The button shows the member's reaction; a summary reading "You" would repeat it.
		await expect(reactButton(page, opening())).toHaveText('Like');
		await expect(summary(page, opening())).toHaveCount(0);

		await clickReact(page, opening());
		expect(await reactionOf('trooper1', opening())).toBeNull();
		await expect(reactButton(page, opening())).toHaveAttribute('aria-pressed', 'false');
		await expect(summary(page, opening())).toHaveCount(0);
	});

	test('picking from the picker reacts with that reaction, and the change survives a reload', async ({
		page,
	}) => {
		await openThread(page);

		await pickReaction(page, opening(), 'Love');

		expect(await reactionOf('trooper1', opening())).toBe('Love');
		await expect(reactButton(page, opening())).toHaveText('Love');
		await expect(reactButton(page, opening())).toHaveAttribute('aria-pressed', 'true');

		await page.reload();
		await expect(reactButton(page, opening())).toHaveText('Love');
	});

	test('picking another reaction switches to it rather than adding a second', async ({ page }) => {
		await openThread(page);

		await pickReaction(page, opening(), 'Love');
		await pickReaction(page, opening(), 'Haha');

		expect(await reactionOf('trooper1', opening())).toBe('Haha');
		expect(await countReactions(opening())).toBe(1);
		await expect(reactButton(page, opening())).toHaveText('Haha');
	});

	test('picking the reaction already held takes it back', async ({ page }) => {
		await react('trooper1', opening(), 'Wow');
		await openThread(page);

		await pickReaction(page, opening(), 'Wow');

		expect(await reactionOf('trooper1', opening())).toBeNull();
		await expect(reactButton(page, opening())).toHaveText('Like');
	});

	test('clicking the button while holding a reaction other than the default takes that one back', async ({
		page,
	}) => {
		await react('trooper1', opening(), 'Sad');
		await openThread(page);
		await expect(reactButton(page, opening())).toHaveText('Sad');

		await clickReact(page, opening());

		expect(await reactionOf('trooper1', opening())).toBeNull();
	});

	test('the summary counts everybody, says "You and N others", and pictures the most used first', async ({
		page,
	}) => {
		await react('trooper2', opening(), 'Haha');
		await react('trooper3', opening(), 'Haha');
		await react('author', opening(), 'Love');
		await react('staff', opening(), 'Wow');
		await openThread(page);

		await expect(summary(page, opening())).toContainText('4');
		// Haha twice; Love and Wow once each, which the picker orders Love first.
		expect(await summaryIcons(page, opening())).toEqual(['Haha', 'Love', 'Wow']);

		await pickReaction(page, opening(), 'Sad');
		await expect(summary(page, opening())).toContainText('You and 4 others');
		// Only three are pictured by default; Sad is used once and comes last.
		expect(await summaryIcons(page, opening())).toEqual(['Haha', 'Love', 'Wow']);

		await clickReact(page, opening());
		await expect(summary(page, opening())).toHaveText('4');
	});

	test('"You and 1 other" is singular', async ({ page }) => {
		await react('trooper2', opening(), 'Like');
		await openThread(page);

		await pickReaction(page, opening(), 'Love');

		await expect(summary(page, opening())).toContainText('You and 1 other');
		await expect(summary(page, opening())).not.toContainText('others');
	});

	test('each post has its own bar, and reacting to one leaves the others alone', async ({
		page,
	}) => {
		const [first, second] = mainThread().pids;
		await openThread(page);

		await pickReaction(page, second, 'Wow');

		expect(await reactionOf('trooper1', second)).toBe('Wow');
		expect(await reactionOf('trooper1', first)).toBeNull();
		await expect(reactButton(page, first)).toHaveText('Like');
	});

	test('members can react to their own posts', async ({ page }) => {
		const own = mainThread().pids[3];
		await openThread(page);

		await clickReact(page, own);

		expect(await reactionOf('trooper1', own)).toBe('Like');
	});

	test('a closed thread can still be reacted to', async ({ page }) => {
		const { tid, pids } = (await import('../helpers/db')).fixtures().threads.closed;
		await openThread(page, tid);

		await clickReact(page, pids[0]);

		expect(await reactionOf('trooper1', pids[0])).toBe('Like');
		await expect(bar(page, pids[0])).toBeVisible();
	});
});
