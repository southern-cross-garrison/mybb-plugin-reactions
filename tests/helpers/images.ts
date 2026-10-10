/**
 * Files for the Admin CP's image upload, made in memory so the suite carries no binary
 * fixtures.
 */

/** A 1x1 transparent PNG. */
const PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
	'base64'
);

/** A 1x1 GIF. */
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

export type Upload = { name: string; mimeType: string; buffer: Buffer };

export const png = (name = 'fire.png'): Upload => ({ name, mimeType: 'image/png', buffer: PNG });

export const gif = (name = 'fire.gif'): Upload => ({ name, mimeType: 'image/gif', buffer: GIF });

/** A real PNG, padded past `kb` kilobytes - getimagesize() only reads the header. */
export const bigPng = (kb: number): Upload => ({
	name: 'big.png',
	mimeType: 'image/png',
	buffer: Buffer.concat([PNG, Buffer.alloc(kb * 1024 + 1)]),
});

/** Not an SVG at all, named as if it were. */
export const fakeSvg = (): Upload => ({
	name: 'fire.svg',
	mimeType: 'image/svg+xml',
	buffer: Buffer.from('<?php echo "not an svg"; ?>'),
});

/** Not an image at all, named as if it were. */
export const fakePng = (): Upload => ({
	name: 'fire.png',
	mimeType: 'image/png',
	buffer: Buffer.from('<?php echo "not an image"; ?>'),
});
