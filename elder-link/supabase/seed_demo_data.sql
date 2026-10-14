-- ============================================================================
-- Elder Link — demo seed data (clearly labelled)
--
-- Adds a small set of sample elders so the dashboard and the Cantonese demo
-- call have something to work with. Every name carries a "(DEMO)" suffix so
-- nobody mistakes them for real enrolments.
--
-- Safe to re-run: uses fixed UUIDs and ON CONFLICT DO NOTHING.
-- Remove with:  DELETE FROM public.elders WHERE display_name LIKE '%(DEMO)%';
-- ============================================================================

INSERT INTO public.elders (
  id, display_name, reference_number, district, centre, phone,
  preferred_language, preferred_call_time,
  consent_elder, consent_contact, consent_service, consent_checked_at,
  status, check_interval_days, next_check_at, last_check_at
) VALUES
  (
    'a1111111-1111-4111-8111-111111111111',
    '陳婆婆 Chan Po Po (DEMO)', 'DEMO-0001', '深水埗 Sham Shui Po', 'Sham Shui Po', '+852 5000 0001',
    'yue', '10:00',
    true, true, true, now(),
    'active', 2, now() - interval '3 hours', now() - interval '2 days'
  ),
  (
    'a2222222-2222-4222-8222-222222222222',
    '李伯伯 Lee Pak Pak (DEMO)', 'DEMO-0002', '觀塘 Kwun Tong', 'Kwun Tong', '+852 5000 0002',
    'yue', '14:30',
    true, true, true, now(),
    'active', 3, now() + interval '1 day', now() - interval '2 days'
  ),
  (
    'a3333333-3333-4333-8333-333333333333',
    '黃婆婆 Wong Po Po (DEMO)', 'DEMO-0003', '黃大仙 Wong Tai Sin', 'Wong Tai Sin', '+852 5000 0003',
    'yue', '09:30',
    true, true, true, now(),
    'active', 2, now() - interval '1 hour', now() - interval '1 day'
  )
ON CONFLICT (id) DO NOTHING;

-- Two contacts per elder: the escalation chain needs a priority 1 and 2.
INSERT INTO public.contacts (elder_id, name, relation, phone, priority) VALUES
  ('a1111111-1111-4111-8111-111111111111', '陳小明 Chan Siu Ming (DEMO)', '兒子 Son',   '+852 5100 0001', 1),
  ('a1111111-1111-4111-8111-111111111111', '何姑娘 Ms Ho (DEMO)',         '鄰居 Neighbour', '+852 5100 0002', 2),
  ('a2222222-2222-4222-8222-222222222222', '李家欣 Lee Ka Yan (DEMO)',    '女兒 Daughter', '+852 5100 0003', 1),
  ('a2222222-2222-4222-8222-222222222222', '譚先生 Mr Tam (DEMO)',        '社工 Social worker', '+852 5100 0004', 2),
  ('a3333333-3333-4333-8333-333333333333', '黃志強 Wong Chi Keung (DEMO)', '兒子 Son',     '+852 5100 0005', 1),
  ('a3333333-3333-4333-8333-333333333333', '陳姑娘 Ms Chan (DEMO)',       '社工 Social worker', '+852 5100 0006', 2)
ON CONFLICT (elder_id, priority) DO NOTHING;

-- A little call history so the analytics screen is not empty.
INSERT INTO public.call_jobs (elder_id, kind, attempt, status, outcome, activity_suggestion, due_at, started_at, completed_at) VALUES
  ('a1111111-1111-4111-8111-111111111111', 'scheduled', 1, 'completed', 'safe', '今日天氣好，可以去附近公園散步十五分鐘。', now() - interval '2 days', now() - interval '2 days', now() - interval '2 days' + interval '1 minute'),
  ('a2222222-2222-4222-8222-222222222222', 'scheduled', 1, 'completed', 'safe', '可以打個電話同老朋友傾吓偈。', now() - interval '2 days', now() - interval '2 days', now() - interval '2 days' + interval '1 minute'),
  ('a3333333-3333-4333-8333-333333333333', 'scheduled', 1, 'completed', 'safe', '試吓做五分鐘伸展運動。', now() - interval '1 day', now() - interval '1 day', now() - interval '1 day' + interval '1 minute')
ON CONFLICT DO NOTHING;

-- Note: 黃婆婆's next_check_at is in the past, so she shows as "overdue"
-- on the dashboard — useful for demonstrating the overdue state.
