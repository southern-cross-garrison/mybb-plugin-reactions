import path from 'node:path';

export const REPO_ROOT = path.resolve(__dirname, '../..');
export const DEVENV_DIR = path.join(REPO_ROOT, '.devenv');
export const FORUM_DIR = path.join(REPO_ROOT, 'test-forum');
export const AUTH_DIR = path.join(DEVENV_DIR, 'auth');

export const BASE_URL = process.env.BASE_URL ?? 'http://localhost:8090';

export const DB = {
	host: process.env.DB_HOST ?? '127.0.0.1',
	port: Number(process.env.DB_PORT ?? 3317),
	user: process.env.DB_USER ?? 'mybb',
	password: process.env.DB_PASSWORD ?? 'mybbpassword',
	database: process.env.DB_NAME ?? 'mybb',
};

export const TABLE_PREFIX = 'mybb_';

/** Every fixture user shares this password (see scripts/provision.php). */
export const FIXTURE_PASSWORD = 'testpass123';

export const ADMIN = { username: 'admin', password: 'adminpass123' };
