-- A gateway URL client's mode (decision 0074): every URL client kept so far
-- is plain; every other client has none.
UPDATE parties
SET credential = jsonb_set(credential, '{client,urlMode}', CASE WHEN credential->'client'->>'source' = 'url' THEN '"plain"'::jsonb ELSE 'null'::jsonb END)
WHERE credential->>'kind' = 'personSignIn'
  AND NOT (credential->'client' ? 'urlMode');

-- A gateway URL client id, so its client metadata document is found by one
-- indexed read; the URL alone names its party.
ALTER TABLE "parties" ADD COLUMN IF NOT EXISTS "url_client_id" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "parties_url_client_id_key" ON "parties"("url_client_id");
UPDATE parties
SET url_client_id = credential->'client'->>'clientId'
WHERE credential->>'kind' = 'personSignIn'
  AND credential->'client'->>'source' = 'url'
  AND url_client_id IS NULL;
