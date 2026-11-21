-- V6__day_night_12h.sql
-- The person's real 12 h crews (amendment 18): D12 07:00-19:00 and N12 19:00-07:00.
-- Templates only for the 100 seed; its A12/P12/L16 assignments, checksum and payroll golden are
-- unchanged. The 150 dataset seeds its own crews and unit agreements (including ADM/ESC).

-- A new published baseline rule set: the existing rows with an additive U-02 kind list and the
-- U-10 wording moved from 00-12 to 19-07. Nothing is loosened; D12/N12 are added to the kinds the
-- rest and consecutive-night rules already inspect.
UPDATE rule_set_version SET status = 'SUPERSEDED' WHERE version = 1;

INSERT INTO rule_set_version
    (id, version, status, based_on_version, effective_from, change_reason, published_at)
VALUES
    ('00000000-0000-0000-0000-000000000002', 2, 'PUBLISHED', 1, DATE '2026-11-21',
     'D12/N12 12 h crews: rest after a 12 h shift and consecutive overnight 19-07 shifts',
     TIMESTAMPTZ '2026-11-21 00:00:00+00');

INSERT INTO rule_row
    (rule_set_version_id, rule_table_id, code, params, severity, override_policy, message, source,
     is_placeholder, sort_order)
SELECT '00000000-0000-0000-0000-000000000002', rule_table_id, code, params, severity,
       override_policy, message, source, is_placeholder, sort_order
FROM rule_row
WHERE rule_set_version_id = '00000000-0000-0000-0000-000000000001';

UPDATE rule_row
SET params = jsonb_set(
        params,
        '{afterShiftKind}',
        to_jsonb('(D8|E8|N8|A12|P12|D12|N12)'::text))
WHERE rule_set_version_id = '00000000-0000-0000-0000-000000000002' AND code = 'U-02';

UPDATE rule_row
SET message = 'More than 4 consecutive overnight (00-12 or 19-07) shifts.'
WHERE rule_set_version_id = '00000000-0000-0000-0000-000000000002' AND code = 'U-10';

INSERT INTO shift_template
    (code, label, start_time, duration_minutes, regular_allowed, chip_style, effective_from,
     rule_set_version_id)
VALUES
    ('D12', 'Day 12 h', TIME '07:00', 720, true, 'day', DATE '2027-01-04',
     '00000000-0000-0000-0000-000000000002'),
    ('N12', 'Night 12 h', TIME '19:00', 720, true, 'night', DATE '2027-01-04',
     '00000000-0000-0000-0000-000000000002');
