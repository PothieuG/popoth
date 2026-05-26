-- Sprint 01 Projets d'épargne — Foundation DB
--
-- Adds the savings_projects table + 4 atomic RPCs (create/update/delete/
-- apply_recap_projects_snapshot). A savings project lets the user set a
-- savings target with a monthly allocation (e.g. "Japan trip: 7000€ over
-- 36 months -> 195€/month"). The monthly allocation behaves as a virtual
-- budget that the RAV (remaining-to-live) formula must account for —
-- wiring into the RAV calculation happens in Sprint 04, finalize wiring
-- into the recap pipeline happens in Sprint 10. This migration only sets
-- up the storage and the atomic ops.
--
-- Patterns mirror estimated_budgets (same FOR ALL RLS policy shape, same
-- owner-exclusive CHECK, same partial indexes per owner, same FK ON DELETE
-- CASCADE) and delete_budget_with_savings_transfer (lock + UPSERT piggy +
-- DELETE pattern in delete_savings_project_to_piggy).
--
-- Owner exclusivity: a row has either profile_id (perso scope) OR
-- group_id (group scope), never both, never neither.
--
-- pending_delay_fraction is the fractional carry-over of a deadline shift
-- across recaps. When a user partially refunds a monthly contribution to
-- cover a deficit, the deadline is shifted by FLOOR(accumulated fraction)
-- months and the residual fraction persists until the next recap pushes
-- it past 1. Full refund (refund = monthly_allocation) => +1 month
-- immediately. Partial refunds accumulate.

CREATE TABLE IF NOT EXISTS "savings_projects" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "profile_id" uuid,
  "group_id" uuid,
  "name" text NOT NULL,
  "target_amount" numeric(12, 2) NOT NULL,
  "monthly_allocation" numeric(12, 2) NOT NULL,
  "deadline_date" date NOT NULL,
  "amount_saved" numeric(12, 2) NOT NULL DEFAULT 0,
  "pending_delay_fraction" numeric(6, 4) NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE "savings_projects"
  ADD CONSTRAINT "savings_projects_pkey" PRIMARY KEY (id);

ALTER TABLE "savings_projects"
  ADD CONSTRAINT "savings_projects_profile_id_fkey"
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;

ALTER TABLE "savings_projects"
  ADD CONSTRAINT "savings_projects_group_id_fkey"
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE;

ALTER TABLE "savings_projects"
  ADD CONSTRAINT "savings_projects_name_not_empty_check"
  CHECK ((TRIM(BOTH FROM name) <> ''::text));

ALTER TABLE "savings_projects"
  ADD CONSTRAINT "savings_projects_name_min_len_check"
  CHECK (LENGTH(TRIM(BOTH FROM name)) >= 2);

ALTER TABLE "savings_projects"
  ADD CONSTRAINT "savings_projects_target_positive_check"
  CHECK ((target_amount > (0)::numeric));

ALTER TABLE "savings_projects"
  ADD CONSTRAINT "savings_projects_monthly_positive_check"
  CHECK ((monthly_allocation > (0)::numeric));

ALTER TABLE "savings_projects"
  ADD CONSTRAINT "savings_projects_amount_saved_check"
  CHECK ((amount_saved >= (0)::numeric));

ALTER TABLE "savings_projects"
  ADD CONSTRAINT "savings_projects_pending_delay_range_check"
  CHECK ((pending_delay_fraction >= (0)::numeric AND pending_delay_fraction < (1)::numeric));

ALTER TABLE "savings_projects"
  ADD CONSTRAINT "savings_projects_owner_exclusive_check"
  CHECK ((((profile_id IS NOT NULL) AND (group_id IS NULL)) OR ((profile_id IS NULL) AND (group_id IS NOT NULL))));

CREATE INDEX IF NOT EXISTS idx_savings_projects_profile_id
  ON public.savings_projects USING btree (profile_id)
  WHERE (profile_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_savings_projects_group_id
  ON public.savings_projects USING btree (group_id)
  WHERE (group_id IS NOT NULL);

CREATE TRIGGER update_savings_projects_updated_at
  BEFORE UPDATE ON public.savings_projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE "savings_projects" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Group members can manage group savings projects"
  ON "savings_projects"
  FOR ALL
  USING (((group_id IS NOT NULL) AND (group_id IN ( SELECT profiles.group_id
   FROM profiles
  WHERE (profiles.id = auth.uid())))));

CREATE POLICY "Users can manage their own savings projects"
  ON "savings_projects"
  FOR ALL
  USING ((profile_id = auth.uid()));

-- ============================================================================
-- RPCs
-- ============================================================================

-- RPC 1: create a savings project atomically.
CREATE OR REPLACE FUNCTION create_savings_project(
  p_name text,
  p_target numeric,
  p_monthly numeric,
  p_deadline date,
  p_profile_id uuid DEFAULT NULL,
  p_group_id uuid DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project savings_projects%ROWTYPE;
BEGIN
  IF (p_profile_id IS NULL AND p_group_id IS NULL)
     OR (p_profile_id IS NOT NULL AND p_group_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Exactly one of p_profile_id or p_group_id must be provided';
  END IF;

  INSERT INTO savings_projects (
    name, target_amount, monthly_allocation, deadline_date,
    profile_id, group_id
  ) VALUES (
    p_name, p_target, p_monthly, p_deadline,
    p_profile_id, p_group_id
  )
  RETURNING * INTO v_project;

  RETURN row_to_json(v_project);
END;
$$;

REVOKE ALL ON FUNCTION create_savings_project(text, numeric, numeric, date, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_savings_project(text, numeric, numeric, date, uuid, uuid) TO service_role;

-- RPC 2: update editable fields (name, target, monthly, deadline) atomically.
-- Does NOT touch amount_saved or pending_delay_fraction — those are mutated
-- exclusively by the recap apply RPC and the delete-to-piggy RPC.
-- A project owned by a different context surfaces as 'not found'.
CREATE OR REPLACE FUNCTION update_savings_project(
  p_id uuid,
  p_name text,
  p_target numeric,
  p_monthly numeric,
  p_deadline date,
  p_profile_id uuid DEFAULT NULL,
  p_group_id uuid DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project savings_projects%ROWTYPE;
BEGIN
  IF (p_profile_id IS NULL AND p_group_id IS NULL)
     OR (p_profile_id IS NOT NULL AND p_group_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Exactly one of p_profile_id or p_group_id must be provided';
  END IF;

  UPDATE savings_projects
  SET
    name = p_name,
    target_amount = p_target,
    monthly_allocation = p_monthly,
    deadline_date = p_deadline,
    updated_at = now()
  WHERE id = p_id
    AND (
      (p_profile_id IS NOT NULL AND profile_id = p_profile_id)
      OR (p_group_id IS NOT NULL AND group_id = p_group_id)
    )
  RETURNING * INTO v_project;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Savings project not found or not owned by the given context';
  END IF;

  RETURN row_to_json(v_project);
END;
$$;

REVOKE ALL ON FUNCTION update_savings_project(uuid, text, numeric, numeric, date, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_savings_project(uuid, text, numeric, numeric, date, uuid, uuid) TO service_role;

-- RPC 3: delete project + transfer accumulated amount_saved to piggy_bank.
-- Mirror of delete_budget_with_savings_transfer (20260520120000). The
-- amount_saved survives the DELETE by being credited to the owner's
-- piggy_bank in the same transaction. UPSERT branches on the partial
-- unique indexes per owner (idx_piggy_bank_profile_id_unique /
-- idx_piggy_bank_group_id_unique from 20260508000000).
CREATE OR REPLACE FUNCTION delete_savings_project_to_piggy(
  p_id uuid,
  p_profile_id uuid DEFAULT NULL,
  p_group_id uuid DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_amount_saved numeric;
  v_piggy_amount numeric;
BEGIN
  IF (p_profile_id IS NULL AND p_group_id IS NULL)
     OR (p_profile_id IS NOT NULL AND p_group_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Exactly one of p_profile_id or p_group_id must be provided';
  END IF;

  -- Step 1: lock + read amount_saved. Ownership is enforced through
  -- the WHERE clause.
  SELECT COALESCE(amount_saved, 0) INTO v_amount_saved
  FROM savings_projects
  WHERE id = p_id
    AND (
      (p_profile_id IS NOT NULL AND profile_id = p_profile_id)
      OR (p_group_id IS NOT NULL AND group_id = p_group_id)
    )
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Savings project not found or not owned by the given context';
  END IF;

  -- Step 2: forward amount_saved -> piggy_bank only when positive.
  IF v_amount_saved > 0 THEN
    IF p_profile_id IS NOT NULL THEN
      INSERT INTO piggy_bank (profile_id, amount, last_updated)
      VALUES (p_profile_id, v_amount_saved, NOW())
      ON CONFLICT (profile_id) WHERE (profile_id IS NOT NULL AND group_id IS NULL) DO UPDATE
        SET amount = piggy_bank.amount + EXCLUDED.amount,
            last_updated = NOW()
      RETURNING amount INTO v_piggy_amount;
    ELSE
      INSERT INTO piggy_bank (group_id, amount, last_updated)
      VALUES (p_group_id, v_amount_saved, NOW())
      ON CONFLICT (group_id) WHERE (group_id IS NOT NULL AND profile_id IS NULL) DO UPDATE
        SET amount = piggy_bank.amount + EXCLUDED.amount,
            last_updated = NOW()
      RETURNING amount INTO v_piggy_amount;
    END IF;
  END IF;

  -- Step 3: DELETE the project. No other table FKs to savings_projects yet,
  -- so nothing cascades.
  DELETE FROM savings_projects WHERE id = p_id;

  RETURN json_build_object(
    'transferred_amount', v_amount_saved,
    'piggy_amount', v_piggy_amount
  );
END;
$$;

REVOKE ALL ON FUNCTION delete_savings_project_to_piggy(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION delete_savings_project_to_piggy(uuid, uuid, uuid) TO service_role;

-- RPC 4: apply the monthly recap snapshot to all owner's savings projects.
-- Called from finalize_recap_apply_snapshot in Sprint 10 (not wired yet).
-- Reads the owner (profile_id|group_id) from monthly_recaps, then iterates
-- over ALL projects of that owner (no "active" flag — every existing row
-- of the owner gets processed). For each project:
--   refund          := COALESCE(p_allocations->>project_id, 0)
--   frac_added      := refund / monthly_allocation                  in [0, 1]
--   new_pending     := pending_delay_fraction + frac_added           in [0, 2)
--   months_to_shift := FLOOR(new_pending)                            0 or 1
--   amount_saved    += (monthly_allocation - refund)                 what was actually saved
--   pending_delay_fraction := new_pending - months_to_shift          in [0, 1)
--   deadline_date   += months_to_shift months                        shifted iff fraction crossed 1
-- Returns { updated_count, total_refunded }.
--
-- Semantics:
--   * refund = 0           => normal full save (monthly_allocation credited, no shift, no fraction change)
--   * refund = monthly     => full refund (0 saved, +1 month deadline, fraction unchanged)
--   * refund = monthly/2   => half refund (half saved, fraction += 0.5, shift only when fraction crosses 1)
--
-- p_allocations json shape: { "<project-uuid>": "<refund-numeric>", ... }
-- Missing keys are treated as refund=0. Foreign project ids (not owned by
-- the recap owner) are silently ignored because the LOOP only walks
-- the owner's projects.
CREATE OR REPLACE FUNCTION apply_recap_projects_snapshot(
  p_recap_id uuid,
  p_allocations json
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_id uuid;
  v_group_id uuid;
  v_project record;
  v_refund numeric;
  v_frac_added numeric;
  v_new_pending numeric;
  v_months_to_shift integer;
  v_updated_count integer := 0;
  v_total_refunded numeric := 0;
BEGIN
  -- Resolve owner from the recap row
  SELECT profile_id, group_id INTO v_profile_id, v_group_id
  FROM monthly_recaps
  WHERE id = p_recap_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'monthly_recap not found: %', p_recap_id;
  END IF;

  IF (v_profile_id IS NULL AND v_group_id IS NULL)
     OR (v_profile_id IS NOT NULL AND v_group_id IS NOT NULL) THEN
    RAISE EXCEPTION 'monthly_recap % has an invalid owner state', p_recap_id;
  END IF;

  -- Walk all projects of the recap owner, locking each row for the
  -- duration of the loop iteration.
  FOR v_project IN
    SELECT id, monthly_allocation, pending_delay_fraction
    FROM savings_projects
    WHERE (v_profile_id IS NOT NULL AND profile_id = v_profile_id)
       OR (v_group_id IS NOT NULL AND group_id = v_group_id)
    FOR UPDATE
  LOOP
    v_refund := COALESCE((p_allocations->>v_project.id::text)::numeric, 0);

    IF v_refund < 0 THEN
      RAISE EXCEPTION 'refund cannot be negative for project %', v_project.id;
    END IF;
    IF v_refund > v_project.monthly_allocation THEN
      RAISE EXCEPTION 'refund % exceeds monthly_allocation % for project %',
        v_refund, v_project.monthly_allocation, v_project.id;
    END IF;

    v_frac_added := v_refund / v_project.monthly_allocation;
    v_new_pending := v_project.pending_delay_fraction + v_frac_added;
    v_months_to_shift := FLOOR(v_new_pending)::integer;

    UPDATE savings_projects
    SET
      amount_saved = amount_saved + (v_project.monthly_allocation - v_refund),
      pending_delay_fraction = v_new_pending - v_months_to_shift,
      deadline_date = CASE
        WHEN v_months_to_shift >= 1
          THEN (deadline_date + make_interval(months => v_months_to_shift))::date
        ELSE deadline_date
      END,
      updated_at = now()
    WHERE id = v_project.id;

    v_updated_count := v_updated_count + 1;
    v_total_refunded := v_total_refunded + v_refund;
  END LOOP;

  RETURN json_build_object(
    'updated_count', v_updated_count,
    'total_refunded', v_total_refunded
  );
END;
$$;

REVOKE ALL ON FUNCTION apply_recap_projects_snapshot(uuid, json) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION apply_recap_projects_snapshot(uuid, json) TO service_role;

NOTIFY pgrst, 'reload schema';
