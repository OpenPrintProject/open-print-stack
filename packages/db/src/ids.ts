/** Lowercase letters and digits, without i, l, o and u so IDs are easy to read out. */
const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
const LENGTH = 26;

/**
 * A new random ID with a readable prefix, e.g. `usr_2k9f...`.
 * 26 characters of 5 random bits each, so 130 bits of randomness.
 */
export function newId(prefix: string): string {
	const bytes = crypto.getRandomValues(new Uint8Array(LENGTH));
	let id = `${prefix}_`;
	for (const byte of bytes) id += ALPHABET[byte & 31];
	return id;
}
