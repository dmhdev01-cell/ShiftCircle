-- V3__demo_units_and_users.sql
-- Fictional facility setup and the demo sign-in accounts (docs/09-access-control.md §4,
-- docs/10-testing.md §6.2). Everything here is synthetic; the officers themselves are created by
-- the demo data generator so the 90-day roster stays reproducible from the seed.

INSERT INTO unit (id, code, name, kind, allows_12h, allows_16h) VALUES
    ('11111111-1111-1111-1111-000000000001', 'A',   'Unit A · Living unit',   'LIVING',     true,  true),
    ('11111111-1111-1111-1111-000000000002', 'B',   'Unit B · Living unit',   'LIVING',     true,  true),
    ('11111111-1111-1111-1111-000000000003', 'C',   'Unit C · Living unit',   'LIVING',     true,  true),
    ('11111111-1111-1111-1111-000000000004', 'ADM', 'Admissions',             'ADMISSIONS', false, false),
    ('11111111-1111-1111-1111-000000000005', 'CTL', 'Control',                'CONTROL',    true,  false),
    ('11111111-1111-1111-1111-000000000006', 'ESC', 'Escort & transport',     'ESCORT',     false, false);

-- Required staffing per block (docs/10-testing.md §6.2). Coverage is measured hourly (ADR-013),
-- so these counts apply to every hour of their block.
INSERT INTO unit_requirement
    (unit_id, block, min_staff, qualification_id, min_with_qualification, effective_from)
SELECT u.id, v.block, v.min_staff, q.id, v.min_with_qualification, DATE '2026-10-01'
FROM (
    VALUES
    ('A',   'DAY',     5, 'FIRST_AID', 1),
    ('A',   'EVENING', 5, 'FIRST_AID', 1),
    ('A',   'NIGHT',   4, 'FIRST_AID', 1),
    ('B',   'DAY',     5, 'FIRST_AID', 1),
    ('B',   'EVENING', 5, 'FIRST_AID', 1),
    ('B',   'NIGHT',   4, 'FIRST_AID', 1),
    ('C',   'DAY',     5, 'FIRST_AID', 1),
    ('C',   'EVENING', 4, 'FIRST_AID', 1),
    ('C',   'NIGHT',   4, 'FIRST_AID', 1),
    ('ADM', 'DAY',     3, NULL,        0),
    ('ADM', 'EVENING', 3, NULL,        0),
    ('ADM', 'NIGHT',   2, NULL,        0),
    ('CTL', 'DAY',     3, 'CONTROL',   3),
    ('CTL', 'EVENING', 3, 'CONTROL',   3),
    ('CTL', 'NIGHT',   3, 'CONTROL',   3),
    ('ESC', 'DAY',     6, 'ESCORT',    6),
    ('ESC', 'EVENING', 4, 'ESCORT',    4),
    ('ESC', 'NIGHT',   2, 'ESCORT',    2)
) AS v (unit_code, block, min_staff, qualification_code, min_with_qualification)
JOIN unit u ON u.code = v.unit_code
LEFT JOIN qualification q ON q.code = v.qualification_code;

-- Mock sign-in accounts. Real deployments replace these with government SSO (docs/09 §5).
INSERT INTO app_user (id, username, display_name) VALUES
    ('22222222-2222-2222-2222-000000000001', 'm.ellis',    'M. Ellis'),
    ('22222222-2222-2222-2222-000000000002', 'j.chen',     'J. Chen'),
    ('22222222-2222-2222-2222-000000000003', 't.nakamura', 'T. Nakamura'),
    ('22222222-2222-2222-2222-000000000004', 'l.fraser',   'L. Fraser'),
    ('22222222-2222-2222-2222-000000000005', 'p.singh',    'P. Singh'),
    ('22222222-2222-2222-2222-000000000006', 'a.reviewer', 'A. Reviewer'),
    ('22222222-2222-2222-2222-000000000007', 'tv.display', 'Unit office TV');

INSERT INTO app_user_role (user_id, role) VALUES
    ('22222222-2222-2222-2222-000000000001', 'SUPERVISOR'),
    ('22222222-2222-2222-2222-000000000001', 'EMPLOYEE'),
    ('22222222-2222-2222-2222-000000000002', 'SUPERVISOR'),
    ('22222222-2222-2222-2222-000000000002', 'EMPLOYEE'),
    ('22222222-2222-2222-2222-000000000003', 'EMPLOYEE'),
    ('22222222-2222-2222-2222-000000000004', 'RULES_ADMIN'),
    ('22222222-2222-2222-2222-000000000005', 'RULES_APPROVER'),
    ('22222222-2222-2222-2222-000000000006', 'AUDITOR'),
    ('22222222-2222-2222-2222-000000000007', 'DISPLAY');

-- Supervisors see only their units (docs/09 §2 "scope"). The auditor's and display account's
-- access is facility-wide, so they need no scope rows.
INSERT INTO user_unit_scope (user_id, unit_id) VALUES
    ('22222222-2222-2222-2222-000000000001', '11111111-1111-1111-1111-000000000001'),
    ('22222222-2222-2222-2222-000000000001', '11111111-1111-1111-1111-000000000002'),
    ('22222222-2222-2222-2222-000000000002', '11111111-1111-1111-1111-000000000004'),
    ('22222222-2222-2222-2222-000000000002', '11111111-1111-1111-1111-000000000005'),
    ('22222222-2222-2222-2222-000000000002', '11111111-1111-1111-1111-000000000006');
