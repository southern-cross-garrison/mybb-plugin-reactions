import { closeDb } from './helpers/db';
import { releaseSuiteLock } from './helpers/suite-lock';

export default async function globalTeardown(): Promise<void> {
	try {
		await closeDb();
	} finally {
		releaseSuiteLock();
	}
}
