// Ordered schema migrations (CLAUDE.md §4). Never edit a shipped entry — append
// a new one. `schema_version` holds the number of applied migrations.
import type Database from 'better-sqlite3'

export const MIGRATIONS: string[] = [
  // v1 — initial schema
  `
  CREATE TABLE series (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    aliases TEXT NOT NULL DEFAULT '[]',
    danbooru_copyright_tag TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE affiliations (
    id INTEGER PRIMARY KEY,
    series_id INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    aliases TEXT NOT NULL DEFAULT '[]',
    UNIQUE (series_id, name)
  );

  CREATE TABLE characters (
    id INTEGER PRIMARY KEY,
    series_id INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
    affiliation_id INTEGER REFERENCES affiliations(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    aliases TEXT NOT NULL DEFAULT '[]',
    danbooru_tag TEXT UNIQUE,
    created_at INTEGER NOT NULL,
    UNIQUE (series_id, name)
  );

  CREATE TABLE images (
    id INTEGER PRIMARY KEY,
    path TEXT NOT NULL UNIQUE,
    sha256 TEXT NOT NULL UNIQUE,
    phash TEXT,
    width INTEGER,
    height INTEGER,
    rating TEXT NOT NULL DEFAULT 'unknown' CHECK (rating IN ('general','sensitive','r18','unknown')),
    rating_score REAL,
    rating_source TEXT NOT NULL DEFAULT 'auto' CHECK (rating_source IN ('auto','user')),
    kind TEXT NOT NULL DEFAULT 'unknown' CHECK (kind IN ('character','other','unknown')),
    imported_at INTEGER NOT NULL,
    thumbnail_path TEXT,
    organized_path TEXT
  );
  CREATE INDEX images_phash ON images(phash);
  CREATE INDEX images_rating ON images(rating);

  CREATE TABLE image_characters (
    id INTEGER PRIMARY KEY,
    image_id INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,
    character_id INTEGER REFERENCES characters(id) ON DELETE SET NULL,
    status TEXT NOT NULL CHECK (status IN ('auto','confirmed','pending','unknown')),
    source TEXT NOT NULL CHECK (source IN ('auto','user')),
    confidence REAL,
    bbox TEXT,
    candidates TEXT
  );
  CREATE INDEX image_characters_image ON image_characters(image_id);
  CREATE INDEX image_characters_character ON image_characters(character_id);
  CREATE INDEX image_characters_status ON image_characters(status);

  CREATE TABLE embeddings (
    id INTEGER PRIMARY KEY,
    image_id INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,
    image_character_id INTEGER REFERENCES image_characters(id) ON DELETE SET NULL,
    bbox TEXT,
    crop TEXT NOT NULL CHECK (crop IN ('face','person','full')),
    vector BLOB NOT NULL,
    character_id INTEGER REFERENCES characters(id) ON DELETE SET NULL,
    is_reference INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX embeddings_reference ON embeddings(is_reference, character_id);

  CREATE TABLE clusters (
    id INTEGER PRIMARY KEY,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE cluster_members (
    cluster_id INTEGER NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
    embedding_id INTEGER NOT NULL REFERENCES embeddings(id) ON DELETE CASCADE,
    PRIMARY KEY (cluster_id, embedding_id)
  );

  CREATE TABLE action_log (
    id INTEGER PRIMARY KEY,
    action_type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    undone INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL
  );
  `,
  // v2 — classification bookkeeping
  `
  ALTER TABLE images ADD COLUMN classified_at INTEGER;          -- NULL = not run through the tagger yet
  ALTER TABLE images ADD COLUMN rating_review INTEGER NOT NULL DEFAULT 0; -- borderline rating → review
  ALTER TABLE images ADD COLUMN dup_of INTEGER REFERENCES images(id) ON DELETE SET NULL; -- near-duplicate (pHash) of
  ALTER TABLE images ADD COLUMN error TEXT;                    -- last decode/classify error
  CREATE INDEX images_classified ON images(classified_at);
  `,
  // v3 — keep the raw tagger scores so threshold changes re-decide instantly
  `
  ALTER TABLE images ADD COLUMN tag_json TEXT; -- {rating, characters:[{tag,score}]} from the tagger
  `,
  // v4 — outfit/version characters under their base character (folders merge, the tree nests)
  `
  ALTER TABLE characters ADD COLUMN parent_id INTEGER REFERENCES characters(id) ON DELETE SET NULL;
  CREATE INDEX characters_parent ON characters(parent_id);
  `,
  // v5 — character learning: reference vectors (user-confirmed crops + Safebooru
  // pictures) and the learned-character log; images track when they were embedded.
  `
  CREATE TABLE refs (
    id INTEGER PRIMARY KEY,
    character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    source TEXT NOT NULL CHECK (source IN ('user','booru')),
    image_id INTEGER REFERENCES images(id) ON DELETE CASCADE,
    post_id INTEGER,
    vector BLOB NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX refs_character ON refs(character_id);
  CREATE UNIQUE INDEX refs_user ON refs(image_id, character_id) WHERE source = 'user';
  CREATE UNIQUE INDEX refs_booru ON refs(post_id, character_id) WHERE source = 'booru';
  CREATE TABLE learned (
    character_id INTEGER PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
    tag TEXT NOT NULL,
    refs INTEGER NOT NULL,
    learned_at INTEGER NOT NULL
  );
  ALTER TABLE images ADD COLUMN embedded_at INTEGER;
  `,
  // v6 — 소속 조직도: affiliations nest (school → club …) in a user-set order;
  // each game remembers its wiki (Fandom domain) for affiliation lookups.
  `
  ALTER TABLE affiliations ADD COLUMN parent_id INTEGER REFERENCES affiliations(id) ON DELETE SET NULL;
  ALTER TABLE affiliations ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE series ADD COLUMN wiki TEXT;
  `,
  // v7 — library: file size / modified time (sorting), favorite + 0–5 stars,
  // user groups (an image can be in several).
  `
  ALTER TABLE images ADD COLUMN file_size INTEGER;
  ALTER TABLE images ADD COLUMN file_mtime INTEGER;
  ALTER TABLE images ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE images ADD COLUMN stars INTEGER NOT NULL DEFAULT 0;
  CREATE TABLE fav_groups (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE image_groups (
    image_id INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,
    group_id INTEGER NOT NULL REFERENCES fav_groups(id) ON DELETE CASCADE,
    added_at INTEGER NOT NULL,
    PRIMARY KEY (image_id, group_id)
  );
  CREATE INDEX image_groups_group ON image_groups(group_id);
  `,
  // v8 — 중복 정리: near-duplicates the user set aside (moved to <정리 폴더>/중복,
  // hidden from the library) and pairs the user said are not duplicates.
  `
  ALTER TABLE images ADD COLUMN set_aside INTEGER NOT NULL DEFAULT 0;
  CREATE TABLE not_dup (
    a INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,
    b INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,
    PRIMARY KEY (a, b)
  );
  `,
  // v9 — 단체 사진으로만 분류: the user says "a group shot", without naming
  // who is in it (→ <정리 폴더>/단체).
  `
  ALTER TABLE images ADD COLUMN group_only INTEGER NOT NULL DEFAULT 0;
  `,
  // v10 — a 단체 사진 can name its game (→ <정리 폴더>/게임/단체).
  `
  ALTER TABLE images ADD COLUMN group_series_id INTEGER REFERENCES series(id) ON DELETE SET NULL;
  `
]

export function schemaVersion(db: Database.Database): number {
  return db.pragma('user_version', { simple: true }) as number
}

// Apply every pending migration, each in its own transaction.
export function migrate(db: Database.Database): number {
  let v = schemaVersion(db)
  for (; v < MIGRATIONS.length; v++) {
    const sql = MIGRATIONS[v]
    db.transaction(() => {
      db.exec(sql)
      db.pragma(`user_version = ${v + 1}`)
    })()
  }
  return v
}
