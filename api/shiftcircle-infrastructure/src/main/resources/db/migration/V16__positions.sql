-- V16__positions.sql
-- Positions (rank) and supervisor posts (release v1.3, S1; docs/06-data-model.md §3.1).
--
-- The version number follows the merge order: this migration takes the next free number when it
-- merges, so the file name may change and nothing else refers to the number.
--
-- Three things land here, and nothing else:
--   1. a small `position` reference table the employee's classification now points at;
--   2. the `SUPERVISION` unit kind a supervisor post uses;
--   3. the `unit_supervision` link table that says which line units a post covers.
--
-- No unit and no employee row changes: the posts themselves, the supervisors who work them and
-- the demo data that proves them come later (S4). Every dataset checksum, plan fingerprint and
-- payroll golden is therefore unchanged by this migration.

-- ---------------------------------------------------------------------------------------------
-- 1. Position (rank)
-- ---------------------------------------------------------------------------------------------

CREATE TABLE position (
    code           text PRIMARY KEY,
    name           text NOT NULL,
    rank_order     integer NOT NULL CHECK (rank_order > 0),
    is_supervisory boolean NOT NULL DEFAULT false
);

INSERT INTO position (code, name, rank_order, is_supervisory) VALUES
    ('CO', 'Correctional officer', 1, false),
    ('CS', 'Correctional supervisor', 2, true);

-- The employee keeps its classification column; it is now a position code. Every officer is a
-- 'CO' today, so the foreign key holds for every existing row.
ALTER TABLE employee
    ADD CONSTRAINT employee_classification_position_fk
    FOREIGN KEY (classification) REFERENCES position (code);

-- Seniority within rank. It is null for an officer who is already in their rank, so
-- coalesce(position_since, seniority_date) is the service date and every ordering is unchanged.
ALTER TABLE employee ADD COLUMN position_since date NULL;

-- ---------------------------------------------------------------------------------------------
-- 2. The SUPERVISION unit kind
-- ---------------------------------------------------------------------------------------------

ALTER TABLE unit DROP CONSTRAINT unit_kind_check;
ALTER TABLE unit ADD CONSTRAINT unit_kind_check
    CHECK (kind IN ('LIVING', 'ADMISSIONS', 'CONTROL', 'ESCORT', 'OTHER', 'SUPERVISION'));

-- ---------------------------------------------------------------------------------------------
-- 3. Which line units a supervisor post covers
-- ---------------------------------------------------------------------------------------------

CREATE TABLE unit_supervision (
    supervision_unit_id uuid NOT NULL REFERENCES unit (id),
    unit_id             uuid NOT NULL REFERENCES unit (id),
    PRIMARY KEY (supervision_unit_id, unit_id),
    CHECK (supervision_unit_id <> unit_id)
);

-- The parent has to be a SUPERVISION unit. A CHECK cannot read another table, so a trigger does.
CREATE FUNCTION unit_supervision_needs_a_supervision_unit() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    parent_kind text;
BEGIN
    SELECT kind INTO parent_kind FROM unit WHERE id = NEW.supervision_unit_id;
    IF parent_kind <> 'SUPERVISION' THEN
        RAISE EXCEPTION 'unit_supervision.supervision_unit_id must be a SUPERVISION unit'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER unit_supervision_supervision_unit
    BEFORE INSERT OR UPDATE ON unit_supervision
    FOR EACH ROW EXECUTE FUNCTION unit_supervision_needs_a_supervision_unit();

-- ---------------------------------------------------------------------------------------------
-- 4. The acting-supervisor qualification
-- ---------------------------------------------------------------------------------------------

-- It uses the existing employee_qualification table, so no new table is needed. The officer who
-- holds it may work a supervisor post with a warning instead of a block (S2).
INSERT INTO qualification (code, name) VALUES ('ACTING_SUP', 'Acting supervisor');
