import fs from 'node:fs';
import path from 'node:path';
import mysql, { Connection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { DB, FORUM_DIR, TABLE_PREFIX } from './config';
import { runPhp } from './container';

let connection: Connection | null = null;

export async function db(): Promise<Connection> {
	if (!connection) {
		connection = await mysql.createConnection({
			...DB,
			multipleStatements: true,
			dateStrings: true,
		});
	}
	return connection;
}

export async function closeDb(): Promise<void> {
	if (connection) {
		await connection.end();
		connection = null;
	}
}

export async function query<T extends RowDataPacket>(
	sql: string,
	params: unknown[] = []
): Promise<T[]> {
	const [rows] = await (await db()).execute<T[]>(sql, params);
	return rows;
}

export async function queryOne<T extends RowDataPacket>(
	sql: string,
	params: unknown[] = []
): Promise<T | null> {
	const rows = await query<T>(sql, params);
	return rows[0] ?? null;
}

export async function execute(sql: string, params: unknown[] = []): Promise<ResultSetHeader> {
	const [result] = await (await db()).execute<ResultSetHeader>(sql, params);
	return result;
}

export const T = (name: string) => `${TABLE_PREFIX}${name}`;

// ---------------------------------------------------------------------------
// Fixtures written by scripts/provision.php
// ---------------------------------------------------------------------------

export interface ThreadFixture {
	tid: number;
	/** In posting order: pids[0] is the opening post. */
	pids: number[];
}

export interface Fixtures {
	password: string;
	groups: { staff: number };
	forums: { general: number; staff: number };
	users: Record<string, number>;
	threads: { main: ThreadFixture; closed: ThreadFixture; staff: ThreadFixture };
	/** The default reactions, by name. */
	reactions: Record<string, number>;
}

let fixturesCache: Fixtures | null = null;

export function fixtures(): Fixtures {
	if (!fixturesCache) {
		const file = path.join(FORUM_DIR, 'reactions-fixtures.json');
		if (!fs.existsSync(file)) {
			throw new Error(`Fixture map not found at ${file}. Run scripts/bootstrap.sh first.`);
		}
		fixturesCache = JSON.parse(fs.readFileSync(file, 'utf8')) as Fixtures;
	}
	return fixturesCache;
}

export const uid = (username: string): number => {
	const id = fixtures().users[username];
	if (!id) {
		throw new Error(`Unknown fixture user "${username}"`);
	}
	return id;
};

/** A default reaction's id, by name ("Like", "Love", ...). */
export const rid = (name: string): number => {
	const id = fixtures().reactions[name];
	if (!id) {
		throw new Error(`Unknown default reaction "${name}"`);
	}
	return id;
};

/**
 * The posts of "Reactions Test Thread": three by `author` (the opening post and two
 * replies), then one by `trooper1`.
 */
export const mainThread = () => fixtures().threads.main;

// ---------------------------------------------------------------------------
// Plugin state
// ---------------------------------------------------------------------------

const backupOf = (table: string) => `${TABLE_PREFIX}${table}_e2e_backup`;

const REACTIONS_BACKUP = backupOf('reactions');
const NOTIFY_BACKUP = backupOf('users_reactions_notify');
const PLUGIN_CACHE_BACKUP = backupOf('reactions_datacache');

/**
 * Take a copy of the reactions as provisioned - the six defaults - with the datacache row
 * built from them, and each member's notification preference.
 *
 * The admin tests rename, reorder, deactivate and delete reactions, and the User CP tests
 * flip preferences; all of it has to come back before the next test.
 */
export async function snapshotPluginState(): Promise<void> {
	const conn = await db();
	await conn.query(`DROP TABLE IF EXISTS ${REACTIONS_BACKUP}`);
	await conn.query(`CREATE TABLE ${REACTIONS_BACKUP} AS SELECT * FROM ${T('reactions')}`);

	await conn.query(`DROP TABLE IF EXISTS ${NOTIFY_BACKUP}`);
	await conn.query(
		`CREATE TABLE ${NOTIFY_BACKUP} AS SELECT uid, reactions_notify FROM ${T('users')}`
	);

	await conn.query(`DROP TABLE IF EXISTS ${PLUGIN_CACHE_BACKUP}`);
	await conn.query(
		`CREATE TABLE ${PLUGIN_CACHE_BACKUP} AS SELECT * FROM ${T('datacache')} WHERE title = 'reactions'`
	);
}

/**
 * Clear every member's reactions and put the plugin's configuration back as provisioned.
 *
 * The reactions table is restored rather than truncated, so reaction ids are the
 * provisioned ones in every test. Deleting rows does not rewind a MyISAM AUTO_INCREMENT, so
 * a reaction a test adds never reuses an id an earlier test's had.
 */
export async function resetPluginData(): Promise<void> {
	const conn = await db();
	await conn.query(`TRUNCATE TABLE ${T('reactions_post')}`);
	await conn.query(`TRUNCATE TABLE ${T('reactions_notified')}`);

	await conn.query(`DELETE FROM ${T('reactions')}`);
	await conn.query(`INSERT INTO ${T('reactions')} SELECT * FROM ${REACTIONS_BACKUP}`);

	// MyBB reads its datacache from the database on every request, so restoring the row is
	// the same as rebuilding it.
	await conn.query(`DELETE FROM ${T('datacache')} WHERE title = 'reactions'`);
	await conn.query(`INSERT INTO ${T('datacache')} SELECT * FROM ${PLUGIN_CACHE_BACKUP}`);

	await conn.query(
		`UPDATE ${T('users')} u INNER JOIN ${NOTIFY_BACKUP} b ON b.uid = u.uid
        SET u.reactions_notify = b.reactions_notify`
	);

	// The admin log is read back by the admin tests.
	await conn.query(`TRUNCATE TABLE ${T('adminlog')}`);

	await deleteUploadedImages();
}

/** The files in uploads/reactions/ other than its directory-listing guard. */
export function uploadedImages(): string[] {
	const dir = path.join(FORUM_DIR, 'uploads', 'reactions');
	if (!fs.existsSync(dir)) {
		return [];
	}
	return fs.readdirSync(dir).filter((name) => name !== 'index.html');
}

/**
 * Delete the images the admin tests uploaded.
 *
 * Inside the container rather than from here: the web server wrote them, and on a Linux
 * host they belong to its user, not to whoever runs the suite. Skipped when there is
 * nothing to delete, which is most tests, since a round trip into the container is the
 * slowest part of a reset.
 */
async function deleteUploadedImages(): Promise<void> {
	if (uploadedImages().length === 0) {
		return;
	}
	await runPhp(`
foreach(glob(MYBB_ROOT.'uploads/reactions/*') as $file)
{
    if(basename($file) !== 'index.html') { @unlink($file); }
}
echo "deleted";
`);
}

/** Rebuild the reactions datacache row, after a test has changed the table directly. */
export async function rebuildReactionsCache(): Promise<void> {
	await runPhp(`
require_once MYBB_ROOT.'inc/plugins/reactions/inc/reactions_functions.php';
reactions_rebuild_cache();
echo "rebuilt";
`);
}

// ---------------------------------------------------------------------------
// Board content
// ---------------------------------------------------------------------------

/**
 * The board's forum content: every table that holds a thread or post, or a count or cache
 * derived from them. The quick reply tests add posts and the deletion tests remove them,
 * and both are put back before the next test.
 */
const BOARD_CONTENT_TABLES = [
	'threads',
	'posts',
	'forums',
	'threadsread',
	'forumsread',
	'threadsubscriptions',
	'forumsubscriptions',
	'mailqueue',
	'moderatorlog',
	'reportedcontent',
	'searchlog',
];

/** The datacache rows built from threads and posts. */
const BOARD_CONTENT_CACHES = ['stats', 'statistics', 'most_replied_threads', 'most_viewed_threads'];

const USER_COUNTS_BACKUP = backupOf('user_post_counts');
const CACHE_BACKUP = backupOf('datacache');

/** Take a copy of the snapshot's forum content, for restoreBoardContent(). */
export async function snapshotBoardContent(): Promise<void> {
	const conn = await db();
	for (const table of BOARD_CONTENT_TABLES) {
		await conn.query(`DROP TABLE IF EXISTS ${backupOf(table)}`);
		await conn.query(`CREATE TABLE ${backupOf(table)} AS SELECT * FROM ${T(table)}`);
	}

	// Posting bumps the author's counts on their users row, which cannot be restored
	// whole: logging in writes to it too.
	await conn.query(`DROP TABLE IF EXISTS ${USER_COUNTS_BACKUP}`);
	await conn.query(
		`CREATE TABLE ${USER_COUNTS_BACKUP} AS SELECT uid, postnum, threadnum FROM ${T('users')}`
	);

	await conn.query(`DROP TABLE IF EXISTS ${CACHE_BACKUP}`);
	await conn.query(
		`CREATE TABLE ${CACHE_BACKUP} AS SELECT * FROM ${T('datacache')} WHERE title IN (?)`,
		[BOARD_CONTENT_CACHES]
	);
}

/** Put the forum content back the way snapshotBoardContent() found it. */
export async function restoreBoardContent(): Promise<void> {
	const conn = await db();
	for (const table of BOARD_CONTENT_TABLES) {
		await conn.query(`DELETE FROM ${T(table)}`);
		await conn.query(`INSERT INTO ${T(table)} SELECT * FROM ${backupOf(table)}`);
	}

	await conn.query(
		`UPDATE ${T('users')} u INNER JOIN ${USER_COUNTS_BACKUP} b ON b.uid = u.uid
        SET u.postnum = b.postnum, u.threadnum = b.threadnum`
	);

	await conn.query(`DELETE FROM ${T('datacache')} WHERE title IN (?)`, [BOARD_CONTENT_CACHES]);
	await conn.query(`INSERT INTO ${T('datacache')} SELECT * FROM ${CACHE_BACKUP}`);
}

// ---------------------------------------------------------------------------
// Reactions
// ---------------------------------------------------------------------------

/** Record a member's reaction to a post without going through the page. */
export async function react(
	username: string,
	pid: number,
	reaction: string | number
): Promise<void> {
	const reactionId = typeof reaction === 'number' ? reaction : rid(reaction);
	await execute(
		`INSERT INTO ${T('reactions_post')} (pid, uid, rid, dateline) VALUES (?, ?, ?, UNIX_TIMESTAMP())
     ON DUPLICATE KEY UPDATE rid = VALUES(rid)`,
		[pid, uid(username), reactionId]
	);
}

/** The reaction a member has on a post, by name; null for none. */
export async function reactionOf(username: string, pid: number): Promise<string | null> {
	const row = await queryOne<RowDataPacket>(
		`SELECT r.name FROM ${T('reactions_post')} p
       INNER JOIN ${T('reactions')} r ON r.rid = p.rid
      WHERE p.pid = ? AND p.uid = ?`,
		[pid, uid(username)]
	);
	return row ? String(row.name) : null;
}

/** Every reaction row on a post, whatever the reaction. */
export async function countReactions(pid: number): Promise<number> {
	const row = await queryOne<RowDataPacket>(
		`SELECT COUNT(*) AS total FROM ${T('reactions_post')} WHERE pid = ?`,
		[pid]
	);
	return Number(row?.total ?? 0);
}

/** Every reaction row a member has, on any post. */
export async function countReactionsBy(username: string): Promise<number> {
	const row = await queryOne<RowDataPacket>(
		`SELECT COUNT(*) AS total FROM ${T('reactions_post')} WHERE uid = ?`,
		[uid(username)]
	);
	return Number(row?.total ?? 0);
}

export async function getReactionByName(name: string): Promise<RowDataPacket | null> {
	return queryOne<RowDataPacket>(`SELECT * FROM ${T('reactions')} WHERE name = ?`, [name]);
}

export async function getReaction(reactionId: number): Promise<RowDataPacket | null> {
	return queryOne<RowDataPacket>(`SELECT * FROM ${T('reactions')} WHERE rid = ?`, [reactionId]);
}

/**
 * Change a reaction directly - a name, the order, whether it is active - and rebuild the
 * cache the pages read it from.
 */
export async function updateReaction(
	reaction: string | number,
	values: { name?: string; disporder?: number; active?: boolean; image?: string }
): Promise<void> {
	const reactionId = typeof reaction === 'number' ? reaction : rid(reaction);
	const sets: string[] = [];
	const params: unknown[] = [];
	if (values.name !== undefined) {
		sets.push('name = ?');
		params.push(values.name);
	}
	if (values.disporder !== undefined) {
		sets.push('disporder = ?');
		params.push(values.disporder);
	}
	if (values.active !== undefined) {
		sets.push('active = ?');
		params.push(values.active ? 1 : 0);
	}
	if (values.image !== undefined) {
		sets.push('image = ?');
		params.push(values.image);
	}
	params.push(reactionId);
	await execute(`UPDATE ${T('reactions')} SET ${sets.join(', ')} WHERE rid = ?`, params);
	await rebuildReactionsCache();
}

// ---------------------------------------------------------------------------
// Members and their mail
// ---------------------------------------------------------------------------

export async function getUser(username: string): Promise<RowDataPacket> {
	const row = await queryOne<RowDataPacket>(`SELECT * FROM ${T('users')} WHERE uid = ?`, [
		uid(username),
	]);
	if (!row) throw new Error(`User ${username} not found`);
	return row;
}

export async function setUserColumn(
	username: string,
	column: string,
	value: string | number
): Promise<void> {
	await execute(`UPDATE ${T('users')} SET ${column} = ? WHERE uid = ?`, [value, uid(username)]);
}

/** The PMs in a member's inbox whose subject matches, oldest first. */
export async function getPrivateMessages(
	username: string,
	subjectLike = '%'
): Promise<RowDataPacket[]> {
	return query<RowDataPacket>(
		`SELECT pmid, subject, message, fromid FROM ${T('privatemessages')}
      WHERE uid = ? AND folder = 1 AND subject LIKE ? ORDER BY pmid ASC`,
		[uid(username), subjectLike]
	);
}

/** Every PM on the board, in any folder - to prove none was sent, or no copy kept. */
export async function countAllPrivateMessages(): Promise<number> {
	const row = await queryOne<RowDataPacket>(
		`SELECT COUNT(*) AS total FROM ${T('privatemessages')}`
	);
	return Number(row?.total ?? 0);
}

/**
 * Empty every mailbox, counters included. MyBB trusts `unreadpms`: left above zero, the
 * next page shows a new-PM notice for a message that no longer exists, which is a logged
 * warning on PHP 8.
 */
export async function deletePrivateMessages(): Promise<void> {
	await execute(`DELETE FROM ${T('privatemessages')}`, []);
	await execute(`UPDATE ${T('users')} SET totalpms = 0, unreadpms = 0`, []);
}

// ---------------------------------------------------------------------------
// Board state
// ---------------------------------------------------------------------------

export async function getPost(pid: number): Promise<RowDataPacket | null> {
	return queryOne<RowDataPacket>(`SELECT * FROM ${T('posts')} WHERE pid = ?`, [pid]);
}

export async function getSetting(name: string): Promise<string> {
	const row = await queryOne<RowDataPacket>(`SELECT value FROM ${T('settings')} WHERE name = ?`, [
		name,
	]);
	return String(row?.value ?? '');
}

/** The newest administrator log entries, newest first. */
export async function adminLog(): Promise<RowDataPacket[]> {
	return query<RowDataPacket>(
		`SELECT module, action, data FROM ${T('adminlog')} ORDER BY dateline DESC, uid DESC`
	);
}
