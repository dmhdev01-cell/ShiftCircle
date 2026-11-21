-- Preference multi-select (person's request, 2026-11-21): an officer may choose any mix of DAY,
-- EVENING and NIGHT. times_of_day is the canonical stored form; the old single time_of_day column
-- remains readable for one release through the API, but is no longer stored.

ALTER TABLE officer_preference
    ADD COLUMN times_of_day text[] NOT NULL DEFAULT '{}';

-- Backfill the one-release compatibility value: each old single value becomes the same one-element
-- set; NONE and NULL become the empty set (no preference).
UPDATE officer_preference
SET times_of_day = CASE time_of_day
    WHEN 'DAY' THEN ARRAY['DAY']
    WHEN 'EVENING' THEN ARRAY['EVENING']
    WHEN 'NIGHT' THEN ARRAY['NIGHT']
    ELSE '{}'
END;

ALTER TABLE officer_preference
    ADD CONSTRAINT officer_preference_times_of_day_check
    CHECK (times_of_day <@ ARRAY['DAY', 'EVENING', 'NIGHT']::text[]
           AND cardinality(times_of_day) <= 3);

ALTER TABLE officer_preference DROP COLUMN time_of_day;
