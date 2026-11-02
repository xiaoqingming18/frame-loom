export const PROJECT_SCRIPT_SCHEMA_VERSION = 1;
export const PROJECT_SCRIPT_SCHEMA = `
CREATE TABLE script_store_meta (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  schema_version INTEGER NOT NULL,
  project_id TEXT NOT NULL,
  phase TEXT NOT NULL CHECK (phase IN ('pending','scripts-cleared','story-cleared','recycle-cleared','manifest-written','ready')),
  story_revision INTEGER NOT NULL DEFAULT 0 CHECK (story_revision >= 0)
);
CREATE TABLE episodes (
  id TEXT PRIMARY KEY,
  number INTEGER NOT NULL CHECK (number BETWEEN 1 AND 9999),
  title TEXT NOT NULL,
  duration_sec INTEGER NOT NULL DEFAULT 0 CHECK (duration_sec >= 0 AND typeof(duration_sec) = 'integer'),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  core_conflict TEXT NOT NULL DEFAULT '',
  hook_start TEXT NOT NULL DEFAULT '',
  hook_end TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE UNIQUE INDEX episodes_number ON episodes(number) WHERE deleted_at IS NULL;
CREATE TABLE story_elements (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('character','location','prop','costume')),
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','confirmed')),
  description TEXT NOT NULL DEFAULT '',
  attrs TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(attrs)),
  manually_edited INTEGER NOT NULL DEFAULT 0 CHECK (manually_edited IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(id,kind)
);
CREATE TABLE story_element_names (
  element_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  PRIMARY KEY(kind,name_key),
  UNIQUE(element_id,ordinal),
  FOREIGN KEY(element_id,kind) REFERENCES story_elements(id,kind) ON DELETE CASCADE
);
CREATE TRIGGER story_kind_immutable BEFORE UPDATE OF kind ON story_elements
WHEN NEW.kind<>OLD.kind BEGIN SELECT RAISE(ABORT,'element kind is immutable'); END;
CREATE TABLE story_ignored_names (
  kind TEXT NOT NULL CHECK (kind IN ('character','location','prop','costume')),
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  PRIMARY KEY(kind,name_key)
);
CREATE TABLE script_scenes (
  id TEXT PRIMARY KEY,
  episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  location TEXT NOT NULL,
  location_id TEXT REFERENCES story_elements(id) ON DELETE SET NULL,
  time_of_day TEXT NOT NULL CHECK (time_of_day IN ('日','夜')),
  interior INTEGER NOT NULL CHECK (interior IN (0,1)),
  atmosphere TEXT NOT NULL,
  UNIQUE(episode_id,ordinal)
);
CREATE TABLE script_beats (
  id TEXT PRIMARY KEY,
  scene_id TEXT NOT NULL REFERENCES script_scenes(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  type TEXT NOT NULL CHECK (type IN ('action','dialogue')),
  content TEXT,
  speaker TEXT,
  speaker_id TEXT REFERENCES story_elements(id) ON DELETE SET NULL,
  emotion TEXT,
  line TEXT,
  UNIQUE(scene_id,ordinal),
  CHECK ((type = 'action' AND content IS NOT NULL AND speaker IS NULL AND speaker_id IS NULL AND emotion IS NULL AND line IS NULL)
    OR (type = 'dialogue' AND content IS NULL AND speaker IS NOT NULL AND emotion IS NOT NULL AND line IS NOT NULL))
);
CREATE TABLE scene_characters (
  scene_id TEXT NOT NULL REFERENCES script_scenes(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  name TEXT NOT NULL,
  element_id TEXT REFERENCES story_elements(id) ON DELETE SET NULL,
  PRIMARY KEY(scene_id,ordinal),
  UNIQUE(scene_id,name)
);
CREATE UNIQUE INDEX scene_character_element ON scene_characters(scene_id,element_id) WHERE element_id IS NOT NULL;
CREATE TRIGGER scene_location_kind_insert BEFORE INSERT ON script_scenes
WHEN NEW.location_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM story_elements WHERE id=NEW.location_id AND kind='location')
BEGIN SELECT RAISE(ABORT,'location must reference location'); END;
CREATE TRIGGER scene_location_kind_update BEFORE UPDATE OF location_id ON script_scenes
WHEN NEW.location_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM story_elements WHERE id=NEW.location_id AND kind='location')
BEGIN SELECT RAISE(ABORT,'location must reference location'); END;
CREATE TRIGGER beat_speaker_kind_insert BEFORE INSERT ON script_beats
WHEN NEW.speaker_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM story_elements WHERE id=NEW.speaker_id AND kind='character')
BEGIN SELECT RAISE(ABORT,'speaker must reference character'); END;
CREATE TRIGGER beat_speaker_kind_update BEFORE UPDATE OF speaker_id ON script_beats
WHEN NEW.speaker_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM story_elements WHERE id=NEW.speaker_id AND kind='character')
BEGIN SELECT RAISE(ABORT,'speaker must reference character'); END;
CREATE TRIGGER scene_character_kind_insert BEFORE INSERT ON scene_characters
WHEN NEW.element_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM story_elements WHERE id=NEW.element_id AND kind='character')
BEGIN SELECT RAISE(ABORT,'scene character must reference character'); END;
CREATE TRIGGER scene_character_kind_update BEFORE UPDATE OF element_id ON scene_characters
WHEN NEW.element_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM story_elements WHERE id=NEW.element_id AND kind='character')
BEGIN SELECT RAISE(ABORT,'scene character must reference character'); END;
CREATE TABLE script_imports (
  id TEXT PRIMARY KEY,
  episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  digest TEXT NOT NULL,
  base_revision INTEGER NOT NULL CHECK (base_revision > 0),
  context_key TEXT NOT NULL,
  model_key TEXT NOT NULL,
  state TEXT NOT NULL CHECK (json_valid(state)),
  batches TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(batches)),
  applied INTEGER NOT NULL DEFAULT 0 CHECK (applied IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX imports_episode ON script_imports(episode_id,created_at);
`;
