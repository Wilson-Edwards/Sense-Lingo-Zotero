/**
 * Cache keys.
 *
 * Every pure function here is the contract between preprocessing and clicking:
 * both sides must derive the same key from the same text, otherwise a
 * preprocessed entry can never be found again.
 *
 * The entry key is `(attachmentID, wordKey, sentenceKey, promptHash,
 * targetLang)`. The word alone is not enough — `bank` in "river bank" and in
 * "bank account" are different senses — and the sentence alone is not enough
 * either, since one sentence holds a dozen words.
 */

import { normalizeText } from "../reader/sentence";

/**
 * NFC, lower-case, and punctuation trimmed from both ends.
 * `Thoreau` -> `thoreau`, `"proposed",` -> `proposed`.
 */
export function wordKey(raw: string): string {
  return (raw ?? "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .replace(/[^\p{L}\p{N}]+$/u, "");
}

/**
 * Fingerprint of a sentence. Whitespace is already collapsed by
 * `normalizeText`, so line-break differences inside one sentence do not matter.
 */
export function sentenceKey(sentence: string): string {
  return sha1Hex(normalizeText(sentence ?? ""));
}

/**
 * Signature of the prompt a translation was produced with.
 *
 * Built from the *templates*, not the rendered text: the preprocessing job
 * stores thousands of entries under one template, and the click path must
 * compute the same value without repeating the job's user-prompt rendering.
 * Editing the template or switching the target language therefore invalidates
 * the cache, while changing the model (or its sampling settings) does not.
 */
export function promptHash(
  systemTemplate: string,
  userTemplate: string,
  targetLang: string,
): string {
  return sha1Hex(
    `${systemTemplate ?? ""}\u0000${userTemplate ?? ""}\u0000${targetLang ?? ""}`,
  );
}

/** Compact, dependency-free SHA-1 (hex) so keys stay usable in unit tests. */
export function sha1Hex(input: string): string {
  const bytes = utf8Bytes(input ?? "");
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) {
    bytes.push(0);
  }
  const high = Math.floor(bitLength / 0x100000000);
  const low = bitLength >>> 0;
  bytes.push(
    (high >>> 24) & 0xff,
    (high >>> 16) & 0xff,
    (high >>> 8) & 0xff,
    high & 0xff,
    (low >>> 24) & 0xff,
    (low >>> 16) & 0xff,
    (low >>> 8) & 0xff,
    low & 0xff,
  );

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;
  const words = new Array<number>(80);

  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let i = 0; i < 16; i++) {
      const base = offset + i * 4;
      words[i] =
        (bytes[base] << 24) |
        (bytes[base + 1] << 16) |
        (bytes[base + 2] << 8) |
        bytes[base + 3];
    }
    for (let i = 16; i < 80; i++) {
      words[i] = rotateLeft(
        words[i - 3] ^ words[i - 8] ^ words[i - 14] ^ words[i - 16],
        1,
      );
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let i = 0; i < 80; i++) {
      let f: number;
      let k: number;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const temp = (rotateLeft(a, 5) + f + e + k + words[i]) >>> 0;
      e = d;
      d = c;
      c = rotateLeft(b, 30);
      b = a;
      a = temp;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }

  return [h0, h1, h2, h3, h4]
    .map((value) => value.toString(16).padStart(8, "0"))
    .join("");
}

function rotateLeft(value: number, bits: number): number {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0;
}

function utf8Bytes(text: string): number[] {
  const bytes: number[] = [];
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      bytes.push(
        0xe0 | (code >> 12),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return bytes;
}
