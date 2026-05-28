-- Drift cleanup (2026-05-28) — tables fantômes V2 oubliées en prod après le
-- Sprint Clean-Slate-Recap (2026-05-23). La migration 20260523000001 drop V1+V2
-- dans son SQL, mais en prod seul le bloc V1 a effectivement tourné (puis V3
-- recréée par 20260524000000). Cette migration ne touche QUE les V2.
--
-- Idempotente : DROP IF EXISTS no-op si déjà absentes (cas dev).
-- 0 consumer applicatif (audit cross-codebase 2026-05-28).

DROP TABLE IF EXISTS public.recap_snapshots_v2 CASCADE;
DROP TABLE IF EXISTS public.monthly_recaps_v2 CASCADE;

NOTIFY pgrst, 'reload schema';
