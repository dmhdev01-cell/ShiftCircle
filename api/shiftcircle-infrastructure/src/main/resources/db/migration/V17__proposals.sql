-- V17: shift proposals, end to end (v1.3 P1, plan .factory/plans/v1.2-proposals.md §1).
--
-- V1 created `proposal` and `proposal_item` and nothing has used them, so they hold no rows.
-- This migration reshapes them in place instead of adding new tables:
--   * proposal.status becomes WAITING / DECIDED / WITHDRAWN / EXPIRED. Per-item outcomes live on
--     the items; "partly approved" is derived, never stored.
--   * proposal_item.decision gains WITHDRAWN and EXPIRED, plus the decider, comment, the created
--     assignment and the snapshots P2 needs.
-- No dataset checksum, payroll golden or plan fingerprint reads these tables.
--
-- The number rule for v1.3: a migration takes the NEXT FREE number at the moment it merges, so
-- Flyway never sees an out-of-order version on an installed database. V17 was the next free number
-- after S1's V16__positions. Nothing in the code or tests depends on the number.

-- ---------------------------------------------------------------------------------------------
-- proposal
-- ---------------------------------------------------------------------------------------------
ALTER TABLE proposal DROP CONSTRAINT proposal_status_check;

UPDATE proposal SET status = 'WAITING' WHERE status = 'SUBMITTED';
UPDATE proposal SET status = 'DECIDED' WHERE status IN ('ACCEPTED', 'PARTIAL', 'DECLINED');

ALTER TABLE proposal ALTER COLUMN status SET DEFAULT 'WAITING';
ALTER TABLE proposal
    ADD CONSTRAINT proposal_status_check
        CHECK (status IN ('WAITING', 'DECIDED', 'WITHDRAWN', 'EXPIRED'));

ALTER TABLE proposal ADD COLUMN submitted_by uuid REFERENCES app_user (id);
ALTER TABLE proposal ADD COLUMN withdrawn_at timestamptz;

-- A monotonic order for "newest first". submitted_at comes from the business clock, which is
-- frozen on the demo, so two proposals sent in one session share it.
ALTER TABLE proposal ADD COLUMN seq bigint GENERATED ALWAYS AS IDENTITY;

-- The note is free text the officer types; it is short and carries no medical detail (the screen
-- says so, as it does for absences). The length is enforced here so no path can store an essay.
ALTER TABLE proposal
    ADD CONSTRAINT proposal_note_length CHECK (note IS NULL OR char_length(note) <= 500);

CREATE INDEX proposal_employee_submitted_idx ON proposal (employee_id, submitted_at DESC, seq DESC);

-- ---------------------------------------------------------------------------------------------
-- proposal_item
-- ---------------------------------------------------------------------------------------------
ALTER TABLE proposal_item DROP CONSTRAINT proposal_item_decision_check;

ALTER TABLE proposal_item
    ADD CONSTRAINT proposal_item_decision_check
        CHECK (decision IN ('PENDING', 'ACCEPTED', 'DECLINED', 'WITHDRAWN', 'EXPIRED'));

-- The proposer, copied from the proposal so the "one waiting item per officer and start" index can
-- be a plain partial unique index instead of a trigger.
ALTER TABLE proposal_item ADD COLUMN employee_id uuid REFERENCES employee (id);
UPDATE proposal_item i SET employee_id = p.employee_id FROM proposal p WHERE p.id = i.proposal_id;
ALTER TABLE proposal_item ALTER COLUMN employee_id SET NOT NULL;

ALTER TABLE proposal_item ADD COLUMN work_date date;
UPDATE proposal_item SET work_date = (start_at AT TIME ZONE 'America/Regina')::date
 WHERE work_date IS NULL AND start_at IS NOT NULL;
ALTER TABLE proposal_item ALTER COLUMN work_date SET NOT NULL;
ALTER TABLE proposal_item ADD COLUMN sort_order integer NOT NULL DEFAULT 0;
ALTER TABLE proposal_item ADD COLUMN decided_by uuid REFERENCES app_user (id);
ALTER TABLE proposal_item ADD COLUMN decided_at timestamptz;
ALTER TABLE proposal_item ADD COLUMN comment text;
ALTER TABLE proposal_item ADD COLUMN assignment_id uuid REFERENCES shift_assignment (id);
ALTER TABLE proposal_item ADD COLUMN decision_snapshot jsonb;
ALTER TABLE proposal_item ADD COLUMN acknowledged_codes text[];
ALTER TABLE proposal_item ADD COLUMN out_of_ot_order boolean NOT NULL DEFAULT false;
ALTER TABLE proposal_item ADD COLUMN open_shift_id uuid REFERENCES open_shift (id);

-- An ADD names the whole shift. Only ADD is accepted in v1.3 (the `action` column stays for later).
ALTER TABLE proposal_item
    ADD CONSTRAINT proposal_item_add_complete
        CHECK (action <> 'ADD'
               OR (unit_id IS NOT NULL AND shift_template_id IS NOT NULL
                   AND start_at IS NOT NULL AND end_at IS NOT NULL));

ALTER TABLE proposal_item
    ADD CONSTRAINT proposal_item_comment_length
        CHECK (comment IS NULL OR char_length(comment) <= 500);

-- A refusal always says why (at least three characters once trimmed).
ALTER TABLE proposal_item
    ADD CONSTRAINT proposal_item_decline_needs_comment
        CHECK (decision <> 'DECLINED' OR (comment IS NOT NULL AND char_length(btrim(comment)) >= 3));

-- Items are always loaded by their proposal.
CREATE INDEX proposal_item_proposal_idx ON proposal_item (proposal_id);

-- The inbox reads waiting items by unit; My proposals reads by officer (above).
CREATE INDEX proposal_item_unit_decision_idx ON proposal_item (unit_id, decision, start_at);

-- One officer cannot have the same shift waiting twice.
CREATE UNIQUE INDEX proposal_item_one_waiting_per_start
    ON proposal_item (employee_id, start_at) WHERE decision = 'PENDING';
