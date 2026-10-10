import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { ALL_USERS, captureLoginState } from './helpers/auth';
import { BASE_URL, DEVENV_DIR, FORUM_DIR, REPO_ROOT } from './helpers/config';
import { snapshotBoardContent, snapshotPluginState, closeDb } from './helpers/db';
import { acquireSuiteLock } from './helpers/suite-lock';

const run = promisify(execFile);

export default async function globalSetup(): Promise<void> {
	// Before anything is restored or wiped, so a second run bounces off rather than
	// trampling the one already going.
	acquireSuiteLock();

	await assertEnvironmentIsUp();

	// Start every run from the provisioned snapshot so leftovers from a previous run
	// (or a hand-driven poke at the dev forum) cannot influence results.
	await run('./scripts/db-restore.sh', [], { cwd: REPO_ROOT, maxBuffer: 64 * 1024 * 1024 });

	// The reactions as provisioned (the six defaults), which the admin tests rename,
	// reorder and delete; and the forums, which the quick reply and deletion tests post to
	// and delete from.
	await snapshotPluginState();
	await snapshotBoardContent();
	await closeDb();

	fs.rmSync(path.join(DEVENV_DIR, 'auth'), { recursive: true, force: true });
	for (const user of ALL_USERS) {
		await captureLoginState(user);
	}
}

async function assertEnvironmentIsUp(): Promise<void> {
	const hint = 'Run ./scripts/bootstrap.sh first (see README).';

	if (!fs.existsSync(path.join(FORUM_DIR, 'reactions-fixtures.json'))) {
		throw new Error(`Fixture map missing from ${FORUM_DIR}. ${hint}`);
	}

	if (!fs.existsSync(path.join(DEVENV_DIR, 'snapshot.sql'))) {
		throw new Error(`Database snapshot missing from ${DEVENV_DIR}. ${hint}`);
	}

	try {
		const response = await fetch(`${BASE_URL}/index.php`);
		if (!response.ok) {
			throw new Error(`HTTP ${response.status}`);
		}
	} catch (error) {
		throw new Error(`Could not reach ${BASE_URL} (${(error as Error).message}). ${hint}`);
	}
}
