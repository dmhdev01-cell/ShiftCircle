-- Release 4 #10: an 8-hour officer assigned to a night shift is a WARN, not a silent assignment.
-- The planner never does this (8 h officers work D8/E8; nights are 12 h), so this rule is for a
-- supervisor's manual assignment. It is published as rule-set v3 by the same baseline-seeding
-- exception as v1/v2; v2 stays in the table as history and every later edit uses maker/checker.

UPDATE rule_set_version SET status = 'SUPERSEDED' WHERE version = 2;

INSERT INTO rule_set_version
    (id, version, status, based_on_version, effective_from, change_reason, published_at)
VALUES
    ('00000000-0000-0000-0000-000000000003', 3, 'PUBLISHED', 2, DATE '2026-11-22',
     '8-hour officer on a night shift: a WARN for manual assignments (release 4 #10)',
     TIMESTAMPTZ '2026-11-22 00:00:00+00');

INSERT INTO rule_row
    (rule_set_version_id, rule_table_id, code, params, severity, override_policy, message, source,
     is_placeholder, sort_order)
SELECT '00000000-0000-0000-0000-000000000003', rule_table_id, code, params, severity,
       override_policy, message, source, is_placeholder, sort_order
FROM rule_row
WHERE rule_set_version_id = '00000000-0000-0000-0000-000000000002';

INSERT INTO rule_row
    (rule_set_version_id, rule_table_id, code, params, severity, override_policy, message, source,
     is_placeholder, sort_order)
SELECT '00000000-0000-0000-0000-000000000003', id, 'U-16', '{"nightShiftOnly":true}'::jsonb,
       'WARN', 'ACKNOWLEDGE',
       'An 8-hour officer is assigned to a night shift; 8-hour officers work day or evening.',
       'Person (release 4 #10)', true, 205
FROM rule_table WHERE code = 'SHIFT_LENGTHS';
