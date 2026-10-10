import { spawn } from 'node:child_process';
import { REPO_ROOT } from './config';

/**
 * Run a PHP snippet inside the web container with MyBB booted.
 *
 * Used where a test needs MyBB itself rather than its database: rebuilding a cache, or
 * reading or clearing files inside the container.
 */
export async function runPhp(snippet: string): Promise<string> {
	const script = `<?php
define('IN_MYBB', 1);
define('MYBB_ROOT', '/var/www/html/');
define('THIS_SCRIPT', 'e2e.php');
define('NO_ONLINE', 1);
require_once MYBB_ROOT.'inc/init.php';
$lang->load('global');
${snippet}
`;

	const output = await new Promise<string>((resolve, reject) => {
		const child = spawn('docker', ['compose', 'exec', '-T', 'web', 'php', '/dev/stdin'], {
			cwd: REPO_ROOT,
		});

		let stdout = '';
		let stderr = '';
		child.stdout.on('data', (chunk) => (stdout += chunk));
		child.stderr.on('data', (chunk) => (stderr += chunk));
		child.on('error', reject);
		child.on('close', (code) => {
			if (code !== 0) {
				reject(new Error(`runPhp exited with ${code}:\n${stdout}\n${stderr}`));
				return;
			}
			resolve(`${stdout}${stderr}`);
		});

		child.stdin.write(script);
		child.stdin.end();
	});

	if (output.includes('MyBB SQL Error') || output.includes('Fatal error')) {
		throw new Error(`runPhp produced a PHP/SQL error:\n${output}`);
	}

	return output.trim();
}
