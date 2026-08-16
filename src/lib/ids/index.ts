/**
 * UUIDv7 (RFC 9562): 48-bit unix-ms timestamp + version/variant bits + 74 random bits.
 * App-generated (ADR-004) so ids are time-ordered and deterministic in fixtures via
 * the injectable clock/rng.
 */

export interface Uuidv7Options {
  /** Millisecond clock, injectable for tests. Defaults to Date.now. */
  now?: () => number;
  /** Uniform [0,1) rng, injectable for tests. Defaults to crypto randomness. */
  random?: () => number;
}

export function uuidv7(options: Uuidv7Options = {}): string {
  const timestamp = options.now ? options.now() : Date.now();
  const bytes = new Uint8Array(16);

  let ts = timestamp;
  for (let i = 5; i >= 0; i -= 1) {
    bytes[i] = ts % 256;
    ts = Math.floor(ts / 256);
  }

  if (options.random) {
    for (let i = 6; i < 16; i += 1) {
      bytes[i] = Math.floor(options.random() * 256) & 0xff;
    }
  } else {
    crypto.getRandomValues(bytes.subarray(6));
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x70; // version 7
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC variant

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
