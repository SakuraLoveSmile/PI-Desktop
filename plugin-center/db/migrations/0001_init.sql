-- PI Plugin Center — initial schema.
--
-- PostgreSQL is the source of truth. Redis holds queues and leases and can be
-- rebuilt from here plus the outbox. Object storage is deliberately absent:
-- artifacts live in GitHub releases and the CNB mirror, and this database holds
-- the digest that makes a swapped asset detectable.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------- identity --

CREATE TABLE account (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  github_user_id  bigint NOT NULL UNIQUE,
  github_login    text   NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE publisher (
  id           text PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9-]*$'),
  display_name text NOT NULL,
  owner_id     uuid NOT NULL REFERENCES account(id),
  -- Only center operators may set `verified`; the submission pipeline never
  -- writes this column from request data.
  trust        text NOT NULL DEFAULT 'community' CHECK (trust IN ('verified', 'community')),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE github_installation (
  id              bigint PRIMARY KEY,
  account_id      uuid NOT NULL REFERENCES account(id),
  target_type     text NOT NULL CHECK (target_type IN ('User', 'Organization')),
  target_login    text NOT NULL,
  suspended_at    timestamptz,
  revoked_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE source_repository (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider      text NOT NULL DEFAULT 'github',
  owner         text NOT NULL,
  name          text NOT NULL,
  canonical_url text NOT NULL,
  UNIQUE (provider, owner, name)
);

-- The permission evidence behind a publish right, kept so a later dispute can
-- be answered with what GitHub actually said and when.
CREATE TABLE publisher_repository_link (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  publisher_id       text   NOT NULL REFERENCES publisher(id),
  repository_id      uuid   NOT NULL REFERENCES source_repository(id),
  installation_id    bigint NOT NULL REFERENCES github_installation(id),
  verified_role      text   NOT NULL CHECK (verified_role IN ('admin', 'maintain', 'write')),
  evidence_sha256    char(64) NOT NULL,
  verified_at        timestamptz NOT NULL,
  revoked_at         timestamptz,
  UNIQUE (publisher_id, repository_id)
);

-- ------------------------------------------------------------------ plugin --

CREATE TABLE plugin (
  id            text PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]*$'),
  publisher_id  text NOT NULL REFERENCES publisher(id),
  repository_id uuid NOT NULL REFERENCES source_repository(id),
  name          text NOT NULL,
  description   text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  -- A retired id is never reissued; reuse would let a new owner inherit an
  -- installed base that trusted somebody else.
  retired_at    timestamptz
);

CREATE TYPE release_state AS ENUM (
  'submitted', 'ownership_verified', 'source_pinned', 'scanning', 'building',
  'ai_review', 'policy_evaluated', 'approved', 'published',
  'needs_info', 'changes_requested', 'blocked', 'build_failed', 'canceled', 'yanked'
);

CREATE TABLE plugin_release (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plugin_id      text NOT NULL REFERENCES plugin(id),
  version        text NOT NULL,
  channel        text NOT NULL DEFAULT 'stable' CHECK (channel IN ('stable', 'beta')),
  state          release_state NOT NULL DEFAULT 'submitted',
  -- Optimistic concurrency: every transition asserts the row version it read,
  -- so two workers cannot both advance the same release.
  row_version    integer NOT NULL DEFAULT 0,
  source_repo_id uuid NOT NULL REFERENCES source_repository(id),
  source_ref     text NOT NULL,
  source_commit  char(40) NOT NULL,
  source_path    text NOT NULL DEFAULT '.',
  min_pi_desktop text,
  permissions    jsonb NOT NULL DEFAULT '[]'::jsonb,
  published_at   timestamptz,
  yanked_at      timestamptz,
  yanked_reason  text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plugin_id, channel, version)
);

-- At most one published release per plugin, channel, and version.
CREATE UNIQUE INDEX plugin_release_published_unique
  ON plugin_release (plugin_id, channel, version)
  WHERE state = 'published';

CREATE INDEX plugin_release_state_idx ON plugin_release (state, updated_at DESC);

CREATE TABLE artifact (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id   uuid NOT NULL REFERENCES plugin_release(id),
  kind         text NOT NULL CHECK (kind IN ('piplug', 'sbom', 'provenance', 'signature', 'report')),
  file_name    text NOT NULL,
  sha256       char(64) NOT NULL,
  size_bytes   bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 52428800),
  -- Where clients fetch it: the release tag in this project's own repository.
  release_tag  text NOT NULL,
  builder      text,
  built_at     timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (release_id, kind, file_name)
);

-- An artifact digest is written once. Correcting bytes means a new version, and
-- a mismatch found later is an incident rather than a row to update.
CREATE OR REPLACE FUNCTION artifact_digest_is_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW.sha256 IS DISTINCT FROM OLD.sha256 OR NEW.size_bytes IS DISTINCT FROM OLD.size_bytes THEN
    RAISE EXCEPTION 'artifact digest is immutable (artifact %)', OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER artifact_digest_immutable
  BEFORE UPDATE ON artifact
  FOR EACH ROW EXECUTE FUNCTION artifact_digest_is_immutable();

-- -------------------------------------------------------------- submission --

CREATE TABLE submission (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id      uuid NOT NULL REFERENCES plugin_release(id),
  account_id      uuid NOT NULL REFERENCES account(id),
  idempotency_key text NOT NULL,
  payload         jsonb NOT NULL,
  attempt         integer NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, idempotency_key)
);

-- Attempts are append-only. A retry adds a row; it never rewrites the inputs,
-- outputs, or hashes of the attempt it is retrying.
CREATE TABLE review_attempt (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id      uuid NOT NULL REFERENCES plugin_release(id),
  pass            text NOT NULL CHECK (pass IN ('primary', 'critic')),
  attempt         integer NOT NULL,
  model           text NOT NULL,
  prompt_version  text NOT NULL,
  input_sha256    char(64) NOT NULL,
  verdict         text NOT NULL CHECK (verdict IN ('pass', 'block', 'needs_info')),
  risk            text NOT NULL CHECK (risk IN ('none', 'low', 'medium', 'high', 'critical')),
  report          jsonb NOT NULL,
  report_sha256   char(64) NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (release_id, pass, attempt)
);

CREATE TABLE deterministic_gate (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id  uuid NOT NULL REFERENCES plugin_release(id),
  gate        text NOT NULL,
  required    boolean NOT NULL DEFAULT true,
  passed      boolean NOT NULL,
  evidence_sha256 char(64) NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (release_id, gate)
);

CREATE TABLE policy_decision (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id     uuid NOT NULL REFERENCES plugin_release(id),
  decision       text NOT NULL CHECK (decision IN ('approved', 'needs_info', 'blocked', 'build_failed')),
  policy_version text NOT NULL,
  reasons        jsonb NOT NULL DEFAULT '[]'::jsonb,
  decided_at     timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------- catalog and audit --

CREATE TABLE catalog_publication (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  generation     bigserial NOT NULL,
  catalog_sha256 char(64) NOT NULL,
  policy_version text NOT NULL,
  signature      text,
  key_id         text,
  plugin_count   integer NOT NULL,
  published_at   timestamptz NOT NULL DEFAULT now(),
  -- Exactly one generation is current; a rollback makes an older row current
  -- rather than deleting the newer one.
  is_current     boolean NOT NULL DEFAULT false
);

CREATE UNIQUE INDEX catalog_publication_current
  ON catalog_publication ((is_current)) WHERE is_current;

CREATE TABLE audit_event (
  id           bigserial PRIMARY KEY,
  actor        text NOT NULL,
  action       text NOT NULL,
  subject      text NOT NULL,
  request_id   text,
  old_value    jsonb,
  new_value    jsonb,
  reason       text,
  evidence_sha256 char(64),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_event_subject_idx ON audit_event (subject, created_at DESC);

-- Written in the same transaction as the state change it describes, then
-- delivered to the queue. This is what lets Redis be lost without losing work.
CREATE TABLE outbox_event (
  id            bigserial PRIMARY KEY,
  topic         text NOT NULL,
  payload       jsonb NOT NULL,
  available_at  timestamptz NOT NULL DEFAULT now(),
  delivered_at  timestamptz,
  attempts      integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX outbox_event_pending_idx
  ON outbox_event (available_at) WHERE delivered_at IS NULL;

COMMIT;
