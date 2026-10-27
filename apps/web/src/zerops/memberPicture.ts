/**
 * A person's face, as the Zerops app draws one: HQ's picture of them, else the member record's
 * own (`smallAvatarUrl`, then `externalAvatarUrl`, then `largeAvatarUrl`), else Gravatar's for
 * their e-mail — only a real picture there (`d=404`: Gravatar answers 404, never a generated
 * pattern, for an address without one). Their initial on their own hue (`PersonAvatar`) stands
 * in where none is known or a picture fails to load.
 */

/** The member record's own pictures, as `GET /client/{id}/user/list` carries them. */
interface Avatar {
  readonly smallAvatarUrl?: string | null | undefined;
  readonly externalAvatarUrl?: string | null | undefined;
  readonly largeAvatarUrl?: string | null | undefined;
}

const text = (value: string | null | undefined) => {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? null : trimmed;
};

export function memberPicture(input: {
  readonly hq?: string | null | undefined;
  readonly avatar?: Avatar | null | undefined;
  readonly email?: string | null | undefined;
}): string | null {
  const email = text(input.email);
  return (
    text(input.hq) ??
    text(input.avatar?.smallAvatarUrl) ??
    text(input.avatar?.externalAvatarUrl) ??
    text(input.avatar?.largeAvatarUrl) ??
    (email === null ? null : gravatarUrl(email))
  );
}

/** Gravatar's picture for an address; a 404 where the address has none, never a pattern. */
export const gravatarUrl = (email: string, size = 160): string =>
  `https://www.gravatar.com/avatar/${md5(email.trim().toLowerCase())}?s=${size}&d=404`;

const S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14,
  20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6,
  10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];
const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) | 0);

/** MD5 of a string's UTF-8 bytes, in hex: the key Gravatar files a picture under. */
export function md5(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const length = ((bytes.length + 8) >>> 6) + 1;
  const words = new Int32Array(length * 16);
  for (const [index, byte] of bytes.entries()) words[index >> 2]! |= byte << ((index % 4) * 8);
  words[bytes.length >> 2]! |= 0x80 << ((bytes.length % 4) * 8);
  words[length * 16 - 2] = bytes.length * 8;
  let [a0, b0, c0, d0] = [0x67452301, 0xefcdab89 | 0, 0x98badcfe | 0, 0x10325476];
  for (let block = 0; block < words.length; block += 16) {
    let [a, b, c, d] = [a0, b0, c0, d0];
    for (let i = 0; i < 64; i++) {
      const [f, g] =
        i < 16
          ? [(b & c) | (~b & d), i]
          : i < 32
            ? [(d & b) | (~d & c), (5 * i + 1) % 16]
            : i < 48
              ? [b ^ c ^ d, (3 * i + 5) % 16]
              : [c ^ (b | ~d), (7 * i) % 16];
      const sum = (a + f + K[i]! + words[block + g]!) | 0;
      [a, d, c] = [d, c, b];
      b = (b + ((sum << S[i]!) | (sum >>> (32 - S[i]!)))) | 0;
    }
    [a0, b0, c0, d0] = [(a0 + a) | 0, (b0 + b) | 0, (c0 + c) | 0, (d0 + d) | 0];
  }
  return [a0, b0, c0, d0]
    .map((word) =>
      Array.from({ length: 4 }, (_, byte) =>
        ((word >>> (byte * 8)) & 0xff).toString(16).padStart(2, "0"),
      ).join(""),
    )
    .join("");
}
