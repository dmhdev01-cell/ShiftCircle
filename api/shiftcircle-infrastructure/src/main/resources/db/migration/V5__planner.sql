-- Phase 3 planner (ADR-026). A draft never touches shift_assignment until commit; every draft
-- assignment is verified through the rule-check seam before it is stored.

ALTER TABLE app_user_role DROP CONSTRAINT app_user_role_role_check;
ALTER TABLE app_user_role ADD CONSTRAINT app_user_role_role_check
    CHECK (role IN ('EMPLOYEE', 'SUPERVISOR', 'RULES_ADMIN', 'RULES_APPROVER', 'AUDITOR',
                    'DISPLAY', 'PLANNER'));

-- A facility-level planner account for the prototype (mock sign-in, no secret in the repo).
INSERT INTO app_user (id, username, display_name) VALUES
    ('22222222-2222-2222-2222-000000000008', 'p.planner', 'P. Planner')
ON CONFLICT (username) DO NOTHING;
INSERT INTO app_user_role (user_id, role) VALUES
    ('22222222-2222-2222-2222-000000000008', 'PLANNER')
ON CONFLICT DO NOTHING;

CREATE TABLE officer_preference (
    employee_id    uuid PRIMARY KEY REFERENCES employee (id),
    shift_length   integer CHECK (shift_length IN (8, 12, 16)),
    time_of_day    text CHECK (time_of_day IN ('DAY', 'EVENING', 'NIGHT', 'NONE')),
    days_off       text[] NOT NULL DEFAULT '{}',
    max_days_off   integer NOT NULL DEFAULT 2 CHECK (max_days_off BETWEEN 0 AND 4),
    updated_at     timestamptz,
    updated_by     uuid REFERENCES app_user (id)
);

CREATE TABLE plan_draft (
    id              uuid PRIMARY KEY,
    from_date       date NOT NULL,
    to_date         date NOT NULL,
    seed            bigint NOT NULL,
    pattern8h       text NOT NULL
        CHECK (pattern8h IN ('ROTATING_5_2', '5_ON_2_OFF', '7_ON_3_OFF')),
    status          text NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT', 'COMMITTED', 'DISCARDED')),
    version         integer NOT NULL DEFAULT 0,
    created_by      uuid REFERENCES app_user (id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    generated_ms    integer NOT NULL DEFAULT 0,
    scorecard       jsonb,
    warnings        jsonb,
    warning_count   integer NOT NULL DEFAULT 0,
    committed_at    timestamptz,
    committed_by    uuid REFERENCES app_user (id)
);

-- The prototype shows one open draft; generating again replaces it.
CREATE UNIQUE INDEX plan_draft_one_open ON plan_draft ((status)) WHERE status = 'DRAFT';

CREATE TABLE plan_draft_assignment (
    id                 uuid PRIMARY KEY,
    draft_id           uuid NOT NULL REFERENCES plan_draft (id) ON DELETE CASCADE,
    employee_id        uuid NOT NULL REFERENCES employee (id),
    unit_id            uuid NOT NULL REFERENCES unit (id),
    shift_template_id  uuid NOT NULL REFERENCES shift_template (id),
    work_date          date NOT NULL,
    start_at           timestamptz NOT NULL,
    end_at             timestamptz NOT NULL,
    kind               text NOT NULL DEFAULT 'ROSTERED',
    sort_order         integer NOT NULL DEFAULT 0,
    UNIQUE (draft_id, employee_id, start_at)
);

CREATE TABLE plan_draft_gap (
    id          uuid PRIMARY KEY,
    draft_id    uuid NOT NULL REFERENCES plan_draft (id) ON DELETE CASCADE,
    unit_id     uuid NOT NULL REFERENCES unit (id),
    gap_date    date NOT NULL,
    block       text NOT NULL CHECK (block IN ('DAY', 'EVENING', 'NIGHT')),
    required    integer NOT NULL,
    placed      integer NOT NULL,
    reason      text,
    UNIQUE (draft_id, unit_id, gap_date, block)
);

-- Committed planner rows stay linked to the draft that created them, so a later draft can tell its
-- own rows from a supervisor's edits and a replacement can be refused rather than overwrite them.
ALTER TABLE shift_assignment ADD COLUMN plan_draft_id uuid REFERENCES plan_draft (id);
CREATE INDEX shift_assignment_plan_draft ON shift_assignment (plan_draft_id);
