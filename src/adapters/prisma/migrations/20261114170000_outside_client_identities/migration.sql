-- Existing sign-in clients were all dynamically registered. Record the
-- authentication previously used, without changing their issuer or secrets.
UPDATE parties
SET credential = jsonb_set(credential, '{client}', (credential->'client') || jsonb_build_object(
  'source', 'automatic',
  'isGatewayOwned', true,
  'tokenEndpointAuthMethod', CASE WHEN credential->'client'->>'clientSecret' IS NULL THEN 'none' ELSE 'client_secret_post' END,
  'revocationEndpointAuthMethods', jsonb_build_array(CASE WHEN credential->'client'->>'clientSecret' IS NULL THEN 'none' ELSE 'client_secret_post' END)
))
WHERE credential->>'kind' = 'personSignIn'
  AND NOT (credential->'client' ? 'source');
