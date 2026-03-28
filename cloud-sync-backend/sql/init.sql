CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vault_blobs (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  encrypted_blob BYTEA NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS snippets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  command TEXT NOT NULL,
  tags TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_name TEXT NOT NULL,
  device_location TEXT NOT NULL DEFAULT '未知地区',
  user_agent TEXT NOT NULL DEFAULT 'unknown',
  device_fingerprint TEXT NOT NULL,
  current_token_jti TEXT,
  token_expires_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS admin_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sync_license_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash TEXT NOT NULL UNIQUE,
  plan_key TEXT NOT NULL,
  duration_days INTEGER,
  is_lifetime BOOLEAN NOT NULL DEFAULT FALSE,
  reserved_email TEXT,
  used_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  used_by_email TEXT,
  disabled BOOLEAN NOT NULL DEFAULT FALSE,
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  activated_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS user_sync_entitlements (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  plan_key TEXT NOT NULL,
  is_lifetime BOOLEAN NOT NULL DEFAULT FALSE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vault_blobs_updated_at ON vault_blobs(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_vault_blobs_version ON vault_blobs(version);
CREATE INDEX IF NOT EXISTS idx_snippets_user_updated_at ON snippets(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_snippets_tags_gin ON snippets USING GIN(tags);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_devices_user_fingerprint ON user_devices(user_id, device_fingerprint);
CREATE INDEX IF NOT EXISTS idx_user_devices_user_last_seen ON user_devices(user_id, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_devices_token_jti ON user_devices(current_token_jti);
CREATE INDEX IF NOT EXISTS idx_sync_license_codes_created_at ON sync_license_codes(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_license_codes_used_by_user ON sync_license_codes(used_by_user_id);
CREATE INDEX IF NOT EXISTS idx_user_sync_entitlements_expires_at ON user_sync_entitlements(expires_at);
