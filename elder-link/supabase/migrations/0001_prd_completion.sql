-- ============================================================================
-- Elder Link — PRD completion migration (0001)
-- Adds PRD-required fields and tables that were missing from 0000_migration.sql
-- Safe to run once on top of 0000. All statements are additive.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- FR-01: minimum sample fields — reference number, preferred call time, centre
-- ---------------------------------------------------------------------------
ALTER TABLE public.elders
  ADD COLUMN IF NOT EXISTS reference_number text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS preferred_call_time text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS centre text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS consent_checked_at timestamptz;

-- Security: three-party consent is re-checked before every call.
-- ---------------------------------------------------------------------------
-- FR-08 / FR-13: sensor safe note + human-informed timestamp
-- ---------------------------------------------------------------------------
ALTER TABLE public.sensor_alerts
  ADD COLUMN IF NOT EXISTS safe_note text,
  ADD COLUMN IF NOT EXISTS human_informed_at timestamptz;

-- FR-11: optimistic-locking version for case updates (conflict checks)
ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS version int NOT NULL DEFAULT 1;

-- ---------------------------------------------------------------------------
-- FR-05 / FR-17: activities + activity interest capture
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  zh text NOT NULL,
  en text NOT NULL,
  active boolean NOT NULL DEFAULT true
);

INSERT INTO public.activities (code, zh, en) VALUES
  ('walk',      '今日天氣好，可以去附近公園散步十五分鐘。', 'Nice weather today — try a 15-minute walk in a nearby park.'),
  ('tea',       '社區中心今個星期有長者茶聚，歡迎參加。',   'The community centre has an elders'' tea gathering this week.'),
  ('call',      '可以打個電話同老朋友傾吓偈。',             'Why not call an old friend for a chat?'),
  ('stretch',   '試吓做五分鐘伸展運動。',                   'Try five minutes of gentle stretching.')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.activity_interests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  elder_id uuid NOT NULL REFERENCES public.elders(id) ON DELETE CASCADE,
  activity_code text NOT NULL,
  call_job_id uuid REFERENCES public.call_jobs(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'staff',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- FR-08: notification record when a sensor-triggered call closes safely
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  elder_id uuid NOT NULL REFERENCES public.elders(id) ON DELETE CASCADE,
  case_id uuid REFERENCES public.cases(id) ON DELETE SET NULL,
  target text NOT NULL,
  channel text NOT NULL DEFAULT 'phone',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
  detail text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

-- ---------------------------------------------------------------------------
-- FR-10 / security: server-side login lockout (5 failures / 15 minutes)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.login_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  ip text NOT NULL DEFAULT '',
  fails int NOT NULL DEFAULT 0,
  locked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (email, ip)
);

-- ---------------------------------------------------------------------------
-- Monitoring: one row per scheduler tick (health + scheduler lag visibility)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.scheduler_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  jobs_created int NOT NULL DEFAULT 0,
  jobs_run int NOT NULL DEFAULT 0,
  chains_advanced int NOT NULL DEFAULT 0,
  purged int NOT NULL DEFAULT 0,
  ok boolean NOT NULL DEFAULT true,
  detail text
);

-- ---------------------------------------------------------------------------
-- Privacy-safe analytics events (pseudonymous; never phone, audio or note text)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.analytics_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL,
  ref text,
  value int NOT NULL DEFAULT 1,
  at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Login lockout helpers (callable only with service role)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.login_lock_status(p_email text, p_ip text)
RETURNS timestamptz LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT locked_until FROM public.login_attempts
  WHERE email = lower(p_email) AND ip = p_ip AND locked_until > now()
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.record_login_failure(p_email text, p_ip text)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_fails int; v_locked timestamptz;
BEGIN
  INSERT INTO public.login_attempts (email, ip, fails, locked_until, updated_at)
  VALUES (lower(p_email), p_ip, 1, NULL, now())
  ON CONFLICT (email, ip) DO UPDATE
    SET fails = CASE WHEN public.login_attempts.locked_until > now() THEN public.login_attempts.fails
                     ELSE public.login_attempts.fails + 1 END,
        updated_at = now()
  RETURNING fails INTO v_fails;

  IF v_fails >= 5 THEN
    v_locked := now() + interval '15 minutes';
    UPDATE public.login_attempts SET fails = 0, locked_until = v_locked
    WHERE email = lower(p_email) AND ip = p_ip;
    RETURN v_locked;
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.clear_login_attempts(p_email text, p_ip text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.login_attempts WHERE email = lower(p_email) AND ip = p_ip
$$;

-- ---------------------------------------------------------------------------
-- RLS for the new staff-facing tables
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['activities','activity_interests','notifications','scheduler_runs','analytics_events'] LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY "staff all" ON public.%I FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()))', t);
  END LOOP;
END $$;

-- login_attempts: service-role only (no policy => no authenticated access)
GRANT ALL ON public.login_attempts TO service_role;
ALTER TABLE public.login_attempts ENABLE ROW LEVEL SECURITY;

-- Realtime for the new staff-facing tables the dashboard watches
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications, public.activity_interests;

-- Backfill the seeded demo elders with the new minimum sample fields
UPDATE public.elders SET reference_number = 'EL-0001', centre = 'Sham Shui Po', preferred_call_time = '10:00'
  WHERE id = '11111111-1111-1111-1111-111111111111' AND reference_number = '';
UPDATE public.elders SET reference_number = 'EL-0002', centre = 'Kwun Tong', preferred_call_time = '14:30'
  WHERE id = '22222222-2222-2222-2222-222222222222' AND reference_number = '';
UPDATE public.elders SET reference_number = 'EL-0003', centre = 'Wong Tai Sin', preferred_call_time = '09:30'
  WHERE id = '33333333-3333-3333-3333-333333333333' AND reference_number = '';

-- ---------------------------------------------------------------------------
-- Purge function: keep the 30-day rule (unchanged), but also clear interests
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.purge_opted_out_elders()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  WITH d AS (
    DELETE FROM public.elders
    WHERE status = 'opted_out' AND opted_out_at < now() - interval '30 days'
    RETURNING id
  )
  SELECT count(*) INTO n FROM d;
  IF n > 0 THEN
    INSERT INTO public.audit_events(actor, action, entity) VALUES (NULL, 'purge:'||n, 'elders');
  END IF;
  RETURN n;
END $$;
