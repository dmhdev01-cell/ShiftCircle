-- Option C (obs 33): the shift pattern is an officer setting, not a facility switch.
--
-- The column is the officer's 8-hour pattern. A 12-hour officer's pattern is the
-- crew's fixed 4-on/4-off cycle, which rotation_pattern already holds, so it is
-- derived read-only instead of copied here; there is one source and no drift.
-- Existing rows take the default; every seed writes it too.
ALTER TABLE employee
    ADD COLUMN shift_pattern text NOT NULL DEFAULT 'ROTATING_5_2'
        CHECK (shift_pattern IN ('ROTATING_5_2', '5_ON_2_OFF', '7_ON_3_OFF'));

COMMENT ON COLUMN employee.shift_pattern IS
    'The 8-hour rotation pattern; a 12-hour officer uses the crew 4-on/4-off cycle.';

-- A per-officer draft has no single facility pattern; the old request parameter is
-- an optional one-release override and still stores its code when sent.
ALTER TABLE plan_draft ALTER COLUMN pattern8h DROP NOT NULL;
