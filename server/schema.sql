-- D1 schema for server/diag-worker.mjs. Idempotent: safe to run again.
CREATE TABLE IF NOT EXISTS uploads (
  id      TEXT PRIMARY KEY,
  at      INTEGER NOT NULL,   -- server time, ms
  app     TEXT NOT NULL,
  device  TEXT NOT NULL,      -- random per television (diag.js), not the DUID
  version TEXT,               -- installed package
  running TEXT,               -- the code that ran (an update, or the package)
  reason  TEXT,
  manual  INTEGER,
  country TEXT,               -- from Cloudflare; the IP itself is not kept
  colo    TEXT,
  ua      TEXT,
  via     TEXT,               -- https, or http when the set could not do TLS to us
  tv_at   INTEGER,            -- the television's own clock, ms: skew is a diagnosis too
  tz      INTEGER,
  n       INTEGER,
  body    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS uploads_device_at ON uploads (device, at);
CREATE INDEX IF NOT EXISTS uploads_at ON uploads (at);
CREATE TABLE IF NOT EXISTS daily (
  day TEXT PRIMARY KEY,
  n   INTEGER NOT NULL
);
