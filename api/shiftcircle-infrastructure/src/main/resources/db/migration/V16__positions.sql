-- positions migration (release v1.3 S1)
-- Positions (rank) and supervisor posts (release v1.3, S1; docs/06-data-model.md §3.1).
--
-- Three things land here, and nothing else:
--   1. a small `position` reference table the employee's classification now points at;
--   2. the `SUPERVISION` unit kind a supervisor post uses;
--   3. the `unit_supervision` link table that says which line units a post covers.
--
-- No unit and no employee row changes: the posts themselves, the supervisors who work them and
-- the demo data that proves them come later (S4). Every dataset checksum, plan fingerprint and
-- payroll golden is therefore unchanged by this migration.
--
-- The version number follows the merge order: this migration takes the next free number when it
-- merges, so the file name may change and nothing else refers to the number.

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

-- A promotion cannot be before the service date: the rank seniority would then be older than the
-- service it is measured against. A date in the future cannot be a CHECK (PostgreSQL wants an
-- immutable expression, and the clock is not one), so the service that writes the date checks it
-- when it starts writing rows (S2).
ALTER TABLE employee
    ADD CONSTRAINT employee_position_since_after_seniority
    CHECK (position_since IS NULL OR position_since >= seniority_date);

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

-- The parent has to be a SUPERVISION unit and the child a line unit: a post covers line units, not
-- another post. A CHECK cannot read another table, so a trigger does. The function pins its
-- search_path, so the name 'unit' cannot be shadowed by an object earlier in the path.
CREATE FUNCTION unit_supervision_needs_a_supervision_unit() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    parent_kind text;
    child_kind text;
BEGIN
    SELECT kind INTO parent_kind FROM unit WHERE id = NEW.supervision_unit_id;
    IF parent_kind IS DISTINCT FROM 'SUPERVISION' THEN
        RAISE EXCEPTION 'unit_supervision.supervision_unit_id must be a SUPERVISION unit'
            USING ERRCODE = '23514';
    END IF;
    SELECT kind INTO child_kind FROM unit WHERE id = NEW.unit_id;
    -- A missing child is not a post, so the trigger lets it through and the foreign key answers
    -- with the missing row; a child that is a post is refused here.
    IF child_kind = 'SUPERVISION' THEN
        RAISE EXCEPTION 'unit_supervision.unit_id must be a line unit, not a supervisor post'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER unit_supervision_supervision_unit
    BEFORE INSERT OR UPDATE ON unit_supervision
    FOR EACH ROW EXECUTE FUNCTION unit_supervision_needs_a_supervision_unit();

-- A unit's kind cannot change while a link points at it: a post that stops being a post would
-- leave a link whose parent is not a post, and a line unit that becomes a post would become the
-- child of a link. Deleting a unit with links is already refused by the foreign key.
CREATE FUNCTION unit_kind_cannot_change_under_a_link() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.kind IS DISTINCT FROM OLD.kind THEN
        IF EXISTS (SELECT 1 FROM unit_supervision WHERE supervision_unit_id = NEW.id) THEN
            RAISE EXCEPTION 'unit % has supervision links and cannot change kind', NEW.code
                USING ERRCODE = '23514';
        END IF;
        IF EXISTS (SELECT 1 FROM unit_supervision WHERE unit_id = NEW.id) THEN
            RAISE EXCEPTION 'unit % is covered by a supervisor post and cannot change kind', NEW.code
                USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER unit_kind_link_guard
    BEFORE UPDATE OF kind ON unit
    FOR EACH ROW EXECUTE FUNCTION unit_kind_cannot_change_under_a_link();

-- ---------------------------------------------------------------------------------------------
-- 4. The acting-supervisor qualification
-- ---------------------------------------------------------------------------------------------

-- It uses the existing employee_qualification table, so no new table is needed. The officer who
-- holds it may work a supervisor post with a warning instead of a block (S2).
INSERT INTO qualification (code, name) VALUES ('ACTING_SUP', 'Acting supervisor');
