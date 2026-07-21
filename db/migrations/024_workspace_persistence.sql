-- Anonymous workspace persistence for the local vertical slice.
-- Production deployments should bind workspace_id to users.id after Auth/RBAC is enabled.

CREATE TABLE workspace_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ
);

CREATE TABLE workspace_saved_searches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspace_sessions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  query JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE workspace_shortlists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspace_sessions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  item_sirens CHAR(9)[] NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE workspace_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspace_sessions(id) ON DELETE CASCADE,
  draft_type TEXT NOT NULL CHECK (draft_type IN ('cv', 'proposal')),
  title TEXT NOT NULL,
  target_siren CHAR(9),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX workspace_saved_searches_recent_idx ON workspace_saved_searches(workspace_id, updated_at DESC);
CREATE INDEX workspace_shortlists_recent_idx ON workspace_shortlists(workspace_id, updated_at DESC);
CREATE INDEX workspace_drafts_recent_idx ON workspace_drafts(workspace_id, updated_at DESC);
