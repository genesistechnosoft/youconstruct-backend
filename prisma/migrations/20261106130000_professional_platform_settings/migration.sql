-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: professional_platform_settings
-- Seeds the five professional platform settings so they are available in
-- production without relying on `pnpm prisma db seed` (which does not run
-- in the deploy pipeline).
--
-- Uses INSERT ... ON CONFLICT DO NOTHING so it is safe to re-run and does
-- not overwrite admin-edited values.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO platform_settings
  (id, namespace, key, value, "valueType", label, description, "isEditable", "isPublic", "createdAt", "updatedAt")
VALUES
  (
    gen_random_uuid(), 'professional', 'autoApproveProfiles', 'false'::jsonb,
    'BOOLEAN', 'Auto-approve professional profiles',
    'When enabled, professional profiles are automatically approved on submit without admin review.',
    true, false, NOW(), NOW()
  ),
  (
    gen_random_uuid(), 'professional', 'autoApproveProjects', 'false'::jsonb,
    'BOOLEAN', 'Auto-approve professional projects',
    'When enabled, submitted projects are automatically approved without admin review.',
    true, false, NOW(), NOW()
  ),
  (
    gen_random_uuid(), 'professional', 'maxCategoriesPerProfile', '5'::jsonb,
    'NUMBER', 'Max categories per professional profile',
    'Maximum number of categories a professional profile can be linked to.',
    true, false, NOW(), NOW()
  ),
  (
    gen_random_uuid(), 'professional', 'maxProjectsPerProfessional', '100'::jsonb,
    'NUMBER', 'Max projects per professional',
    'Maximum number of non-deleted projects a professional can have.',
    true, false, NOW(), NOW()
  ),
  (
    gen_random_uuid(), 'professional', 'maxPhotosPerProject', '20'::jsonb,
    'NUMBER', 'Max photos per project',
    'Maximum number of photos that can be attached to a single project.',
    true, false, NOW(), NOW()
  ),
  (
    gen_random_uuid(), 'professional', 'removalPurgeDelayDays', '30'::jsonb,
    'NUMBER', 'Removal purge delay (days)',
    'Days to wait after a project is REMOVED before purging its media from storage. Set to 0 to purge immediately.',
    true, false, NOW(), NOW()
  )
ON CONFLICT ("namespace", "key") DO NOTHING;
