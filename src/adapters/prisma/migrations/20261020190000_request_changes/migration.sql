-- The pages' live channel: every change to a fleet's pending requests is
-- announced on commit, naming only its fleet and topic, never content.
CREATE FUNCTION "notify_request_change"() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('gateway_changes', json_build_object('fleetId', NEW."fleet_id", 'topic', 'requests')::text);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "pending_requests_changed"
AFTER INSERT OR UPDATE ON "pending_requests"
FOR EACH ROW EXECUTE FUNCTION "notify_request_change"();
