/**
 * A random secret the Mate asks the person to add (`zerops_propose_env secret=true generate=…`),
 * made in their browser at their press, exactly as Zerops' preprocessor (zParser) makes it — so a
 * value made here is the one an import would have made. Only the directives zcp allows
 * (`internal/ops/secret_ask.go`, `SecretGenerate`) are read; anything else is no recipe and the
 * card asks for a typed value instead. The value goes from here to the vault write and nowhere
 * else: never shown, never sent to the engine.
 */

/**
 * What a directive makes: `string`, `length` characters (`generateRandomString(<N>)`); `int`, an
 * integer in [min, max] (`generateRandomInt(<min>, <max>)`).
 */
export type SecretRecipe =
  | { readonly kind: "string"; readonly length: number }
  | { readonly kind: "int"; readonly min: bigint; readonly max: bigint };

const STRING = /^<@generateRandomString\(<(\d+)>\)>$/u;
const INT = /^<@generateRandomInt\(<(-?\d+)>,\s*<(-?\d+)>\)>$/u;

/** zcp's bounds: the recipe's shortest secret, and zParser's own limit (`maxRandBytesLen`). */
const MIN_LENGTH = 16;
const MAX_LENGTH = 1024;
const INT64_MIN = -(2n ** 63n);
const INT64_MAX = 2n ** 63n - 1n;
/** zParser draws from max − min + 1, which zcp keeps under 2^62. */
const MAX_SPAN = 2n ** 62n;

/** The recipe a directive names, or `null` for anything zcp does not allow. */
export function readSecretRecipe(expression: string | undefined): SecretRecipe | null {
  if (expression === undefined) return null;
  const text = expression.trim();
  const string = STRING.exec(text);
  if (string !== null) {
    const length = Number(string[1]);
    return Number.isInteger(length) && length >= MIN_LENGTH && length <= MAX_LENGTH
      ? { kind: "string", length }
      : null;
  }
  const int = INT.exec(text);
  if (int === null) return null;
  const min = BigInt(int[1] ?? "");
  const max = BigInt(int[2] ?? "");
  if (min < INT64_MIN || max > INT64_MAX || max <= min || max - min >= MAX_SPAN) return null;
  return { kind: "int", min, max };
}

/** zParser's alphabet for a random string (`util.randStringChars`): 65 characters. */
const ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-.";

type Fill = (target: Uint8Array<ArrayBuffer>) => Uint8Array;
const cryptoFill: Fill = (target) => crypto.getRandomValues(target);

/**
 * Makes the value: a string maps each random byte onto the alphabet as zParser's
 * `util.BytesToString` does (a byte above 64 taken modulo 64); an integer is uniform in
 * [min, max], as zParser's `crypto/rand.Int` draw, by rejection over 64 random bits.
 */
export function makeSecret(recipe: SecretRecipe, fill: Fill = cryptoFill): string {
  if (recipe.kind === "string") {
    const bytes = fill(new Uint8Array(recipe.length));
    let out = "";
    for (const byte of bytes) out += ALPHABET[byte > 64 ? byte % 64 : byte];
    return out;
  }
  const span = recipe.max - recipe.min + 1n;
  const limit = 2n ** 64n - (2n ** 64n % span);
  for (;;) {
    const bytes = fill(new Uint8Array(8));
    let draw = 0n;
    for (const byte of bytes) draw = (draw << 8n) | BigInt(byte);
    if (draw < limit) return (recipe.min + (draw % span)).toString(10);
  }
}

/** What the card will make, in people's words. */
export function secretRecipeWords(recipe: SecretRecipe): string {
  return recipe.kind === "string"
    ? `A random value, ${String(recipe.length)} characters, made in your browser`
    : `A random number from ${recipe.min.toString()} to ${recipe.max.toString()}, made in your browser`;
}
