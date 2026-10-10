import { test as base, expect, Page } from '@playwright/test';
import { resetPluginData, restoreBoardContent, deletePrivateMessages } from './db';
import { errorLogMark, errorLogSince } from './error-log';

/**
 * Every test starts with nobody having reacted to anything, the six default reactions as
 * provisioned, the forums as the snapshot has them and every mailbox empty.
 *
 * And every test ends by checking that nothing it did made MyBB log a warning or an SQL
 * error. The board logs those rather than printing them (scripts/provision.php), so a
 * page can look right and still have raised one - on PHP 8 an undefined variable in a
 * template is exactly that. A test that means to provoke one opts out with
 * `test.use({ allowErrorLog: true })`.
 */
export const test = base.extend<{ cleanBoard: void; errorLog: void; allowErrorLog: boolean }>({
	allowErrorLog: [false, { option: true }],

	cleanBoard: [
		async ({}, use) => {
			await resetPluginData();
			await restoreBoardContent();
			await deletePrivateMessages();
			await use();
		},
		{ auto: true },
	],

	errorLog: [
		async ({ allowErrorLog }, use) => {
			const mark = errorLogMark();
			await use();
			if (!allowErrorLog) {
				const logged = errorLogSince(mark);
				expect(logged, `MyBB logged errors during this test:\n${logged}`).toBe('');
			}
		},
		{ auto: true },
	],
});

export { expect };

/** Assert the page is MyBB's "no permission" / error page carrying a given message. */
export async function expectMyBBError(page: Page, message: string | RegExp): Promise<void> {
	await expect(page.locator('#content, .error, body')).toContainText(message);
}
