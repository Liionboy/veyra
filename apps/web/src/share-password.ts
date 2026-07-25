const PASSWORD_GROUPS = [
  "abcdefghijkmnpqrstuvwxyz",
  "ABCDEFGHJKLMNPQRSTUVWXYZ",
  "23456789",
  "!@#$%^&*",
] as const;

const PASSWORD_ALPHABET = PASSWORD_GROUPS.join("");

export type RandomByteSource = () => number;

function secureRandomByte(): number {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error("Secure password generation is unavailable in this browser.");
  }
  const value = new Uint8Array(1);
  globalThis.crypto.getRandomValues(value);
  return value[0]!;
}

function randomIndex(length: number, randomByte: RandomByteSource): number {
  const unbiasedLimit = 256 - (256 % length);
  for (;;) {
    const value = randomByte();
    if (!Number.isInteger(value) || value < 0 || value > 255) {
      throw new Error("The random byte source returned an invalid value.");
    }
    if (value < unbiasedLimit) return value % length;
  }
}

export function generateSharePassword(
  length = 20,
  randomByte: RandomByteSource = secureRandomByte,
): string {
  if (!Number.isInteger(length) || length < 12 || length > 128) {
    throw new RangeError("Generated passwords must contain 12 to 128 characters.");
  }

  const characters = PASSWORD_GROUPS.map(
    (group) => group[randomIndex(group.length, randomByte)]!,
  );
  while (characters.length < length) {
    characters.push(
      PASSWORD_ALPHABET[randomIndex(PASSWORD_ALPHABET.length, randomByte)]!,
    );
  }

  for (let index = characters.length - 1; index > 0; index -= 1) {
    const target = randomIndex(index + 1, randomByte);
    [characters[index], characters[target]] = [
      characters[target]!,
      characters[index]!,
    ];
  }
  return characters.join("");
}
