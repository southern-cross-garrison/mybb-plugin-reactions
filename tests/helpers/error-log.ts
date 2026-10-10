import fs from 'node:fs';
import path from 'node:path';
import { FORUM_DIR } from './config';
import { runPhp } from './container';

/**
 * Warnings the garrison theme's own templates raise on PHP 8, where an undefined variable
 * or key stopped being a notice MyBB ignores. None is the plugin's: `$avatarep_script`
 * belongs to the Avatarep plugin the theme's headerinclude expects, the guest login modal
 * reads `$captcha` and `$redirect_url`, which MyBB never sets, and the theme's postbit reads
 * `$post['profilefield']`, which MyBB only fills for a post by a registered member - not
 * for a PM from the board itself. Its reply forms read `$closeoption` and `$stickoption`,
 * which MyBB only sets for a moderator, and its forum list reads the last post's thread
 * prefix and icon (`tpprefix`, `tpicon`), which MyBB only sets for a forum whose last thread
 * has them. Matched by exact message and only inside an eval'd template, so anything else a
 * page logs still counts.
 */
const THEME_TEMPLATE_WARNINGS = [
	'Undefined variable $avatarep_script',
	'Undefined variable $captcha',
	'Undefined variable $redirect_url',
	'Undefined array key "profilefield"',
	'Undefined variable $closeoption',
	'Undefined variable $stickoption',
	'Undefined array key "tpprefix"',
	'Undefined array key "tpicon"',
];

// MyBB's log closes the message with its tag and PHP's goes on to say where, so neither
// mistakes `$captcha` for a longer name that merely starts with it.
export const isThemeWarning = (entry: string): boolean =>
	entry.includes("eval()'d code") &&
	THEME_TEMPLATE_WARNINGS.some(
		(warning) => entry.includes(`<message>${warning}</message>`) || entry.includes(`${warning} in `)
	);

/** Empty both logs, so what is read back afterwards was written since. */
export async function clearErrorLogs(): Promise<void> {
	await runPhp(`
@unlink('/var/www/html/cache/mybb_errors.log');
@unlink('/var/log/php_errors.log');
echo "cleared";
`);
}

/**
 * Everything MyBB's error log and PHP's have recorded since clearErrorLogs(), less the
 * theme's own warnings. MyBB's log is a run of `<error>` blocks and PHP's one line per
 * error, so each entry is judged whole.
 */
export async function readErrorLogs(): Promise<string> {
	const log = await runPhp(`
foreach(array('/var/www/html/cache/mybb_errors.log', '/var/log/php_errors.log') as $file)
{
    if(file_exists($file)) { echo file_get_contents($file); }
}
echo "END_OF_LOG";
`);

	const entries = log.replace('END_OF_LOG', '').match(/<error>[\s\S]*?<\/error>|[^\n]+/g) ?? [];
	return entries
		.filter((entry) => entry.trim() !== '' && !isThemeWarning(entry))
		.join('\n')
		.trim();
}

/**
 * MyBB's own error log, read from the bind mount rather than through the container. Every
 * warning a page raises lands here (the board logs rather than shows them, see
 * scripts/provision.php), so watching it is how the suite notices a notice.
 */
const MYBB_ERROR_LOG = path.join(FORUM_DIR, 'cache', 'mybb_errors.log');

/** Where MyBB's error log ends now, so what is read back later was written since. */
export function errorLogMark(): number {
	try {
		return fs.statSync(MYBB_ERROR_LOG).size;
	} catch {
		return 0;
	}
}

/** The entries MyBB has logged since a mark, less the theme's own warnings. */
export function errorLogSince(mark: number): string {
	let text = '';
	try {
		const size = fs.statSync(MYBB_ERROR_LOG).size;
		// Smaller than the mark: something emptied the log in between (clearErrorLogs()).
		const start = size < mark ? 0 : mark;
		const fd = fs.openSync(MYBB_ERROR_LOG, 'r');
		const buffer = Buffer.alloc(size - start);
		fs.readSync(fd, buffer, 0, buffer.length, start);
		fs.closeSync(fd);
		text = buffer.toString('utf8');
	} catch {
		return '';
	}

	const entries = text.match(/<error>[\s\S]*?<\/error>/g) ?? [];
	return entries
		.filter((entry) => !isThemeWarning(entry))
		.join('\n')
		.trim();
}
