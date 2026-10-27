/**
 * A person as every mark draws them: their picture, or one letter on a hue of their own. The hue
 * and the letter are read off the first word of their name, so "Petra" on a change and
 * "Petra Malá" on a team card are the same mark, on every row and every reload, with nothing
 * stored.
 */
export interface PersonMark {
  /** One letter: the first of the name the person goes by. */
  readonly letter: string;
  /** The person's hue, 0–359: one person, one colour, everywhere. */
  readonly hue: number;
  readonly picture: string | null;
}

export function personMark(person: {
  readonly name: string;
  readonly picture?: string | null | undefined;
}): PersonMark {
  const first = person.name.trim().split(/\s+/u)[0] ?? "";
  let hash = 5381;
  for (const character of first.toLocaleLowerCase()) {
    hash = (hash * 33 + (character.codePointAt(0) ?? 0)) % 1_000_003;
  }
  const picture = person.picture?.trim();
  return {
    letter: ([...first][0] ?? "").toLocaleUpperCase(),
    hue: hash % 360,
    picture: picture === undefined || picture === "" ? null : picture,
  };
}
