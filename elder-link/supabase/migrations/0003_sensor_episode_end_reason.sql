-- Record WHY a door-sensor episode ended.
--
-- The "one call per open door" rule works by keeping an episode's row open and
-- treating any later alarm on the same door as a duplicate. That makes closing
-- the row load-bearing: if an episode is never closed, the *next* time the door
-- is left open it is judged a duplicate and the elder is never called again —
-- a silent, permanent failure of the whole feature.
--
-- Because of that, a closed episode needs to say why it closed. There are four
-- different reasons and they mean very different things operationally:
--
--   door_closed                  the door shut normally
--   door_open_under_threshold    the door came back under the firmware's 15s
--   door_reopened                it shut and was opened again within one check
--   cleared_for_testing          a human reset it; must never appear in anger
--
-- Without this column all of those are indistinguishable, and "was the elder
-- ever called?" cannot be answered from the table.
--
-- Nullable on purpose: every row written before this column existed has no
-- reason, and inventing one would be a lie. NULL means "ended by an older build".

ALTER TABLE public.sensor_alerts
  ADD COLUMN IF NOT EXISTS end_reason text;

COMMENT ON COLUMN public.sensor_alerts.end_reason IS
  'Why the episode closed: door_closed | door_open_under_threshold | door_reopened | cleared_for_testing. NULL for rows closed before this column existed.';

-- An index for the hot query: "is there an open episode for this elder?".
-- That runs on every scheduler tick (once a minute, per sensor) and is what
-- decides whether anybody gets called, so it is worth not scanning for.
CREATE INDEX IF NOT EXISTS sensor_alerts_open_by_elder
  ON public.sensor_alerts (elder_id, received_at DESC)
  WHERE status = 'open';
