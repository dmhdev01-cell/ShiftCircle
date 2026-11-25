-- v1.2 (PR-N): the tailoring options a quarter-plan draft was made with, so a draft says what it
-- was made with. The defaults are the generator's behaviour before this migration, so every
-- existing draft reads truthfully as made with the defaults.
--   staff_types     FULL_TIME always; PART_TIME = officers below 1.0 FTE (part-time and casual pool)
--   part_time_fill  AFTER_FULL_TIME (fill gaps only) or UP_TO_FTE (also top up towards FTE)
ALTER TABLE plan_draft
    ADD COLUMN staff_types text[] NOT NULL DEFAULT ARRAY['FULL_TIME', 'PART_TIME']::text[]
        CHECK (staff_types <@ ARRAY['FULL_TIME', 'PART_TIME']::text[]
               AND 'FULL_TIME' = ANY (staff_types)),
    ADD COLUMN part_time_fill text NOT NULL DEFAULT 'AFTER_FULL_TIME'
        CHECK (part_time_fill IN ('AFTER_FULL_TIME', 'UP_TO_FTE'));
