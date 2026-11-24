-- v1.2 (PR-N): the third plan option. ON covers each gap left after the home-unit fills with an
-- officer from another unit (qualified for the block, under FTE x 80 h, no Block rule). The default
-- OFF is the generator before this option, so every older draft reads as made with it off.
ALTER TABLE plan_draft
    ADD COLUMN cross_unit_fill text NOT NULL DEFAULT 'OFF'
        CHECK (cross_unit_fill IN ('OFF', 'ON'));

-- Review N7: V14's CHECK accepts duplicates ({FULL_TIME,FULL_TIME}). The API stores only the two
-- canonical lists, so the column now accepts only those.
ALTER TABLE plan_draft
    ADD CONSTRAINT plan_draft_staff_types_canonical
        CHECK (staff_types IN (ARRAY['FULL_TIME']::text[], ARRAY['FULL_TIME', 'PART_TIME']::text[]));
