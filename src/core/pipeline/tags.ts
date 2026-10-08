// Danbooru character tags → (character, series). The tagger names characters
// `name_(series)`, e.g. `hoshino_(blue_archive)`, `artoria_pendragon_(fate)`.
// Some carry an extra qualifier before the series (`hoshino_(swimsuit)_(blue_archive)`)
// — the LAST parenthesized group is the series, earlier ones stay in the name.

export interface ParsedCharacter {
  tag: string // original tag (kept as an alias / danbooru_tag)
  name: string // display name, e.g. "Hoshino"
  series: string | null // display series, e.g. "Blue Archive"; null when the tag has none
  seriesTag: string | null // raw series part, e.g. "blue_archive"
}

// "blue_archive" → "Blue Archive"; keeps existing capitals and symbols.
export function displayName(raw: string): string {
  return raw
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(^|[\s(-])([a-z])/g, (_m, p: string, c: string) => p + c.toUpperCase())
}

export function parseCharacterTag(tag: string): ParsedCharacter {
  const t = tag.trim()
  // Last "(...)" group at the end of the tag (allowing one level of nesting
  // inside, e.g. "(fate/grand_order)" or "(idolmaster_(classic))").
  const m = t.match(/^(.*?)_?\(((?:[^()]|\([^()]*\))+)\)$/)
  if (!m || !m[1]) return { tag: t, name: displayName(t), series: null, seriesTag: null }
  const seriesTag = m[2]
  return { tag: t, name: displayName(m[1]), series: displayName(seriesTag), seriesTag }
}

// Split "name_(a)_(b)" into its name and trailing parenthesized groups
// (one level of nesting allowed inside a group).
export function tagGroups(tag: string): { name: string; groups: string[] } {
  const groups: string[] = []
  let rest = tag.trim()
  for (;;) {
    const m = rest.match(/^(.*?)_?\(((?:[^()]|\([^()]*\))+)\)$/)
    if (!m || !m[1]) break
    groups.unshift(m[2])
    rest = m[1].replace(/_$/, '')
  }
  return { name: rest, groups }
}

// Base character of an outfit/version tag, or null:
//   hoshino_(swimsuit)_(blue_archive) → hoshino_(blue_archive)
//   yae_miko_(fox) → yae_miko   (only when the bare name is a character of the
//   same game: per the game table, or `isTag` when the table doesn't know the tag)
export function variantBase(tag: string, seriesMap?: Map<string, string>, isTag?: (t: string) => boolean): string | null {
  const { name, groups } = tagGroups(tag)
  if (groups.length >= 2) return `${name}_(${groups[groups.length - 1]})`
  if (groups.length === 1) {
    // The game table decides whether "(x)" is the game or a version.
    // Version only if the bare name is itself a character of the same game
    // (yae_miko_(fox) → yae_miko). "(kancolle)" etc. are game abbreviations.
    const game = seriesMap?.get(tag)
    if (game) return seriesMap!.get(name) === game ? name : null
    // No table entry: only call it a version when the bare name is a
    // character of the same game we know about.
    if (isTag?.(name)) return name
  }
  return null
}
