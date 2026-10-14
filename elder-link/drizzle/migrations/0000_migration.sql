
CREATE TYPE public.app_role AS ENUM ('admin','operator');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;
CREATE OR REPLACE FUNCTION public.is_staff(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id)
$$;

CREATE POLICY "own roles readable" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.handle_new_user_role()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'operator') ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER on_auth_user_created_role AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_role();

CREATE TABLE public.elders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name text NOT NULL,
  district text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  preferred_language text NOT NULL DEFAULT 'yue',
  consent_elder boolean NOT NULL DEFAULT false,
  consent_contact boolean NOT NULL DEFAULT false,
  consent_service boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','opted_out')),
  check_interval_days int NOT NULL DEFAULT 2 CHECK (check_interval_days IN (2,3)),
  next_check_at timestamptz,
  last_check_at timestamptz,
  opted_out_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  elder_id uuid NOT NULL REFERENCES public.elders(id) ON DELETE CASCADE,
  name text NOT NULL,
  relation text NOT NULL DEFAULT '',
  phone text NOT NULL,
  priority int NOT NULL CHECK (priority IN (1,2)),
  UNIQUE (elder_id, priority)
);

CREATE TABLE public.call_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  elder_id uuid NOT NULL REFERENCES public.elders(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('scheduled','demo','sensor','retry')),
  attempt int NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','ringing','completed','no_answer','cancelled')),
  outcome text CHECK (outcome IN ('safe','worrying','danger','unclear','no_answer')),
  activity_suggestion text,
  due_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  elder_id uuid NOT NULL REFERENCES public.elders(id) ON DELETE CASCADE,
  call_job_id uuid REFERENCES public.call_jobs(id) ON DELETE SET NULL,
  reason text NOT NULL CHECK (reason IN ('worrying','danger','unclear','no_answer','sensor')),
  severity int NOT NULL DEFAULT 2,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','closed')),
  note text,
  trigger_at timestamptz NOT NULL DEFAULT now(),
  escalation_started_at timestamptz,
  acknowledged_at timestamptz,
  acknowledged_by uuid,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.escalation_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  step_order int NOT NULL,
  target text NOT NULL CHECK (target IN ('contact1','contact2','operator')),
  target_label text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','calling','answered','no_answer','skipped')),
  started_at timestamptz,
  ended_at timestamptz
);

CREATE TABLE public.sensor_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  elder_id uuid NOT NULL REFERENCES public.elders(id) ON DELETE CASCADE,
  external_id text NOT NULL UNIQUE,
  alert_type text NOT NULL DEFAULT 'inactivity',
  call_job_id uuid REFERENCES public.call_jobs(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  received_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);

CREATE TABLE public.telephony_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id text NOT NULL UNIQUE,
  call_job_id uuid REFERENCES public.call_jobs(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor uuid,
  action text NOT NULL,
  entity text NOT NULL,
  entity_id uuid,
  at timestamptz NOT NULL DEFAULT now()
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['elders','contacts','call_jobs','cases','escalation_steps','sensor_alerts','telephony_events'] LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY "staff all" ON public.%I FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()))', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT ON public.audit_events TO authenticated;
GRANT ALL ON public.audit_events TO service_role;
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read audit" ON public.audit_events FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "staff append audit" ON public.audit_events FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()) AND actor = auth.uid());

-- 30-day deletion after opt-out
CREATE OR REPLACE FUNCTION public.purge_opted_out_elders()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  WITH d AS (DELETE FROM public.elders WHERE status='opted_out' AND opted_out_at < now() - interval '30 days' RETURNING id)
  SELECT count(*) INTO n FROM d;
  IF n > 0 THEN INSERT INTO public.audit_events(actor, action, entity) VALUES (NULL, 'purge:'||n, 'elders'); END IF;
  RETURN n;
END $$;

ALTER PUBLICATION supabase_realtime ADD TABLE public.cases, public.call_jobs, public.escalation_steps, public.elders;

-- Demo sample data (fake)
INSERT INTO public.elders (id, display_name, district, phone, consent_elder, consent_contact, consent_service, status, check_interval_days, next_check_at, last_check_at) VALUES
 ('11111111-1111-1111-1111-111111111111','陳婆婆 Chan Po Po','Sham Shui Po','+852 5000 0001',true,true,true,'active',2, now() - interval '3 hours', now() - interval '2 days 3 hours'),
 ('22222222-2222-2222-2222-222222222222','李伯伯 Lee Pak Pak','Kwun Tong','+852 5000 0002',true,true,true,'active',3, now() + interval '1 day', now() - interval '2 days'),
 ('33333333-3333-3333-3333-333333333333','黃太 Mrs Wong','Wong Tai Sin','+852 5000 0003',true,false,false,'draft',2, NULL, NULL);
INSERT INTO public.contacts (elder_id, name, relation, phone, priority) VALUES
 ('11111111-1111-1111-1111-111111111111','Chan Siu Ming','Son','+852 5100 0001',1),
 ('11111111-1111-1111-1111-111111111111','Ms Ho (Neighbour)','Neighbour','+852 5100 0002',2),
 ('22222222-2222-2222-2222-222222222222','Lee Ka Yan','Daughter','+852 5100 0003',1),
 ('22222222-2222-2222-2222-222222222222','Mr Tam','Social worker','+852 5100 0004',2);
