-- Esquema inicial da API FlorAI (ver docs/API.md do app).
-- Datas em TEXT ISO-8601 UTC com "Z".

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT,
  has_completed_onboarding INTEGER NOT NULL DEFAULT 0,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_iterations INTEGER NOT NULL,
  tz_offset INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE subscriptions (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  plan TEXT NOT NULL CHECK (plan IN ('free', 'basic', 'pro', 'premium')),
  started_at TEXT NOT NULL,
  renews_at TEXT
);

CREATE TABLE daily_usage (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  identifications INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

CREATE TABLE identifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plant_name TEXT NOT NULL,
  scientific_name TEXT NOT NULL,
  family TEXT NOT NULL,
  category TEXT NOT NULL,
  confidence REAL NOT NULL,
  image_key TEXT NOT NULL,
  image_url TEXT NOT NULL,
  description TEXT NOT NULL,
  care_instructions TEXT NOT NULL,
  curiosities TEXT NOT NULL,
  identified_at TEXT NOT NULL
);
CREATE INDEX idx_identifications_user ON identifications(user_id, identified_at DESC);

CREATE TABLE collections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_collections_user ON collections(user_id, created_at);

CREATE TABLE plants (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  identification_id TEXT NOT NULL,
  plant_name TEXT NOT NULL,
  scientific_name TEXT NOT NULL,
  family TEXT NOT NULL,
  category TEXT NOT NULL,
  image_url TEXT NOT NULL,
  description TEXT NOT NULL,
  care_instructions TEXT NOT NULL,
  curiosities TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_plants_user ON plants(user_id, created_at);
CREATE INDEX idx_plants_collection ON plants(collection_id);

CREATE TABLE reminders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plant_id TEXT NOT NULL UNIQUE REFERENCES plants(id) ON DELETE CASCADE,
  interval_days INTEGER NOT NULL,
  hour INTEGER NOT NULL,
  minute INTEGER NOT NULL,
  last_watered_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_reminders_user ON reminders(user_id);
