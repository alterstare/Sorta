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
