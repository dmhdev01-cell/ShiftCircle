-- Release 3 (observation 34): a unit can be closed from a date, optionally reopened
-- later, and the facility carries the staff numbers it is funded for.
--
-- unit.active stays the hard off switch (default true). The date logic lives only in
-- unit_availability, and one SQL function (unit_active_on) is the shared answer every
-- reader uses. No row and active=true means open on every day, so the 100/120 seeds
-- and their checksums/fingerprints are unchanged until a planner closes a unit.

CREATE TABLE unit_availability (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    unit_id       uuid NOT NULL REFERENCES unit (id),
    disabled_from date NOT NULL,
    enabled_from  date,
    reason        text NOT NULL CHECK (length(trim(reason)) >= 5),
    created_by    uuid REFERENCES app_user (id),
    created_at    timestamptz NOT NULL DEFAULT now(),
    CHECK (enabled_from IS NULL OR enabled_from > disabled_from)
);

CREATE UNIQUE INDEX unit_availability_one_per_start
    ON unit_availability (unit_id, disabled_from);
CREATE INDEX unit_availability_unit ON unit_availability (unit_id, disabled_from);

-- A closure is one row; the service refuses an overlap for the same unit (plain
-- message), and this index keeps the same start from being entered twice.
CREATE TABLE unit_staffing (
    unit_id            uuid PRIMARY KEY REFERENCES unit (id),
    allocated_headcount integer NOT NULL CHECK (allocated_headcount >= 0
                                                AND allocated_headcount <= 999),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    updated_by         uuid REFERENCES app_user (id)
);

CREATE TABLE staffing_setting (
    id               integer PRIMARY KEY CHECK (id = 1),
    leave_allowance  numeric(4, 3) NOT NULL DEFAULT 0.200
        CHECK (leave_allowance >= 0 AND leave_allowance < 1),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    updated_by       uuid REFERENCES app_user (id)
);
INSERT INTO staffing_setting (id) VALUES (1);

-- The one shared active-units source. A unit is open on a day when the hard switch
-- is on and no closure covers that day. Closed from D means D is the first closed
-- day; enabled_from is the first open day again.
CREATE OR REPLACE FUNCTION unit_active_on(p_unit uuid, p_day date)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
    SELECT EXISTS (SELECT 1 FROM unit u WHERE u.id = p_unit AND u.active)
       AND NOT EXISTS (
           SELECT 1 FROM unit_availability a
           WHERE a.unit_id = p_unit
             AND p_day >= a.disabled_from
             AND (a.enabled_from IS NULL OR p_day < a.enabled_from))
$$;

COMMENT ON FUNCTION unit_active_on(uuid, date) IS
    'The one active-units source: hard switch plus the closure window covering the day.';
