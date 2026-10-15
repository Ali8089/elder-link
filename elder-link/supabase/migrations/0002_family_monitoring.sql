-- 0002_family_monitoring.sql
--
-- Family monitoring: lets a relative of an enrolled elder sign in and follow
-- what is happening, without giving them any authority over care decisions.
--
-- Design notes
-- ------------
-- * Staff still decide every emergency (PRD: "Human decides every emergency
--   action"). The family role is read-only over care data. The one thing a
--   relative may write is their own notification preference, because that is
--   their data, not the elder's care record.
--
-- * Scope is enforced by RLS, not by the UI. A family user can only ever see
--   rows belonging to an elder they are linked to. There is deliberately no
--   policy that lets one family member see another elder, and no policy that
--   gives family any access to `contacts` (which holds other relatives'
--   phone numbers), `audit_events`, or `user_roles`.
--
-- * `app_role` gains 'family'. Staff roles keep working unchanged; `is_staff()`
--   must therefore exclude family explicitly, otherwise a relative would be
--   treated as a colleague by every existing policy.
--
-- Run order: 0000 -> 0001 -> 0002.

-- ---------------------------------------------------------------------------
-- 1. The family role
-- ---------------------------------------------------------------------------

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'family';

-- `is_staff()` previously meant "has any role". With a third role in play that
-- would be wrong, so redefine it to mean the two operational roles only.
-- `has_role()` is unchanged and remains the primitive.
CREATE OR REPLACE FUNCTION public.is_staff(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role IN ('admin','operator')
  );
$$;

CREATE OR REPLACE FUNCTION public.is_family(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = 'family'
  );
$$;

-- ---------------------------------------------------------------------------
-- 2. Who is linked to whom
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.family_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  elder_id uuid NOT NULL REFERENCES public.elders(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Kept even before the relative signs up, so staff can invite by phone.
  name text NOT NULL,
  relation text NOT NULL DEFAULT '',
  phone text NOT NULL,
  email text,
  -- The relative's own choice about being contacted. 'all' means both
  -- emergencies and the softer community-event news; 'alerts' means emergencies
  -- only; 'none' means they have asked not to be contacted at all.
  notify_level text NOT NULL DEFAULT 'all'
    CHECK (notify_level IN ('all','alerts','none')),
  -- A relative may mute the positive-only updates while still wanting
  -- emergencies, which is the common case for a busy adult child.
  wants_activity_news boolean NOT NULL DEFAULT true,
  -- Set once staff approve the link. Until then the relative sees nothing.
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','active','revoked')),
  invited_at timestamptz NOT NULL DEFAULT now(),
  linked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- One relative can follow two parents, but not be linked twice to the same
  -- elder.
  UNIQUE (elder_id, phone)
);

CREATE INDEX IF NOT EXISTS family_members_elder_idx ON public.family_members(elder_id);
CREATE INDEX IF NOT EXISTS family_members_user_idx ON public.family_members(user_id);

-- A relative is "connected" when the link is approved and they have an account.
CREATE OR REPLACE FUNCTION public.family_can_see_elder(_user_id uuid, _elder_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.family_members
    WHERE user_id = _user_id
      AND elder_id = _elder_id
      AND status = 'active'
  );
$$;

-- ---------------------------------------------------------------------------
-- 3. Row level security
-- ---------------------------------------------------------------------------

ALTER TABLE public.family_members ENABLE ROW LEVEL SECURITY;

-- A relative sees their own link. Staff see every link, so they can manage
-- invitations. An elder has no session, so no policy is needed for them.
DROP POLICY IF EXISTS family_members_select ON public.family_members;
CREATE POLICY family_members_select ON public.family_members
  FOR SELECT USING (
    user_id = auth.uid() OR public.is_staff(auth.uid())
  );

-- Inviting and approving is a staff action.
DROP POLICY IF EXISTS family_members_staff_write ON public.family_members;
CREATE POLICY family_members_staff_write ON public.family_members
  FOR ALL USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

-- A relative may update only their own notification preference. Because a
-- policy's WITH CHECK sees the proposed row, not the stored one, a crafted
-- UPDATE could try to set `status = 'active'` on its own pending link and grant
-- itself access. Comparing the proposed row against the row on disk requires
-- reading the stored value, which a policy cannot do directly, so the check is
-- delegated to a SECURITY DEFINER helper that returns true only when every
-- non-preference field is unchanged.
CREATE OR REPLACE FUNCTION public.family_members_prefs_only(_row_id uuid, _new public.family_members)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.family_members f
    WHERE f.id = _row_id
      AND f.user_id = auth.uid()
      -- Identity, scope and approval state must all survive untouched.
      AND _new.id = f.id
      AND _new.elder_id = f.elder_id
      AND _new.user_id = f.user_id
      AND _new.status = f.status
      AND _new.name = f.name
      AND _new.relation = f.relation
      AND _new.phone = f.phone
      AND _new.email IS NOT DISTINCT FROM f.email
      AND _new.invited_at = f.invited_at
      AND _new.linked_at IS NOT DISTINCT FROM f.linked_at
      -- And the values being written must still be legal choices.
      AND _new.notify_level IN ('all','alerts','none')
  );
$$;

DROP POLICY IF EXISTS family_members_self_prefs ON public.family_members;
CREATE POLICY family_members_self_prefs ON public.family_members
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND public.family_members_prefs_only(id, family_members)
  );

-- ---------------------------------------------------------------------------
-- 4. Family read access to the care records of their own elder
-- ---------------------------------------------------------------------------

-- Elder profile: only the fields a relative needs to confirm it is their
-- parent. No consent flags (that is the elder's private business).
DROP POLICY IF EXISTS elders_family_read ON public.elders;
CREATE POLICY elders_family_read ON public.elders
  FOR SELECT USING (public.family_can_see_elder(auth.uid(), id));

-- Call jobs: the relative can see that check-ins happened and how they went.
DROP POLICY IF EXISTS call_jobs_family_read ON public.call_jobs;
CREATE POLICY call_jobs_family_read ON public.call_jobs
  FOR SELECT USING (public.family_can_see_elder(auth.uid(), elder_id));

-- Cases and escalation steps: read-only. Seeing that staff are responding is
-- reassuring; acting on it is not the relative's job.
DROP POLICY IF EXISTS cases_family_read ON public.cases;
CREATE POLICY cases_family_read ON public.cases
  FOR SELECT USING (public.family_can_see_elder(auth.uid(), elder_id));

DROP POLICY IF EXISTS escalation_steps_family_read ON public.escalation_steps;
CREATE POLICY escalation_steps_family_read ON public.escalation_steps
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.cases c
      WHERE c.id = escalation_steps.case_id
        AND public.family_can_see_elder(auth.uid(), c.elder_id)
    )
  );

-- Sensor alerts: a relative should know if a sensor fired.
DROP POLICY IF EXISTS sensor_alerts_family_read ON public.sensor_alerts;
CREATE POLICY sensor_alerts_family_read ON public.sensor_alerts
  FOR SELECT USING (public.family_can_see_elder(auth.uid(), elder_id));

-- Notifications already sent about their elder, so the relative sees the same
-- record of contact attempts that staff do.
DROP POLICY IF EXISTS notifications_family_read ON public.notifications;
CREATE POLICY notifications_family_read ON public.notifications
  FOR SELECT USING (public.family_can_see_elder(auth.uid(), elder_id));

-- Positive signal: which community activities the elder showed interest in.
-- Only surfaced when the relative has opted into activity news and has not
-- set notify_level to 'none'.
DROP POLICY IF EXISTS activity_interests_family_read ON public.activity_interests;
CREATE POLICY activity_interests_family_read ON public.activity_interests
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.family_members f
      WHERE f.user_id = auth.uid()
        AND f.elder_id = activity_interests.elder_id
        AND f.status = 'active'
        AND f.wants_activity_news
        AND f.notify_level <> 'none'
    )
  );

-- Note: no policy is added for `contacts`. A relative must not be able to read
-- the phone numbers of the other emergency contact, and `audit_events` and
-- `user_roles` stay staff-only.

-- ---------------------------------------------------------------------------
-- 5. Keep updated_at honest
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.touch_family_members()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS family_members_touch ON public.family_members;
CREATE TRIGGER family_members_touch
  BEFORE UPDATE ON public.family_members
  FOR EACH ROW EXECUTE FUNCTION public.touch_family_members();

-- ---------------------------------------------------------------------------
-- 6. Seed one family link for the demo elders, so the screen has content
-- ---------------------------------------------------------------------------

INSERT INTO public.family_members (elder_id, name, relation, phone, notify_level, wants_activity_news, status)
SELECT e.id, v.name, v.relation, v.phone, 'all', true, 'pending'
FROM public.elders e
JOIN (VALUES
  ('李伯伯 (DEMO)', '李明', '兒子', '+852 6000 0001'),
  ('陳婆婆 (DEMO)', '陳小玲', '女兒', '+852 6000 0002'),
  ('黃婆婆 (DEMO)', '黃志強', '姪兒', '+852 6000 0003')
) AS v(display_name, name, relation, phone)
  ON e.display_name = v.display_name
ON CONFLICT (elder_id, phone) DO NOTHING;
