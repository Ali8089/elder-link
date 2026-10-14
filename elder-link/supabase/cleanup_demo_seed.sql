-- ============================================================================
-- Elder Link — remove demo seed data before going live
--
-- 0000_migration.sql seeded three fake elders (陳婆婆, 李伯伯, 黃太) with
-- consent flags set to true and placeholder phone numbers. On a deployed
-- dashboard those look like real enrolments, which is misleading.
--
-- Run this ONCE in the Supabase SQL Editor after the migrations.
-- Safe to re-run.
--
-- NOTE: matches on display_name, NOT id. The live rows' UUIDs turned out to
-- differ from the ones written in 0000_migration.sql (an older insert path
-- generated random ids), so an id-based delete silently missed a row.
-- Deleting an elder cascades to contacts, call jobs and cases.
-- ============================================================================

DELETE FROM public.elders
WHERE display_name IN (
  '陳婆婆 Chan Po Po',
  '李伯伯 Lee Pak Pak',
  '黃太 Mrs Wong'
);

-- Leave an audit trail so it is clear the demo rows were removed deliberately.
INSERT INTO public.audit_events (actor, action, entity, entity_id)
VALUES (NULL, 'seed.removed_for_production', 'elders', NULL);

-- Verify: this should return 0.
-- SELECT count(*) FROM public.elders WHERE display_name IN (
--   '陳婆婆 Chan Po Po', '李伯伯 Lee Pak Pak', '黃太 Mrs Wong'
-- );
