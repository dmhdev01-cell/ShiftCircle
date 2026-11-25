-- supervision posts migration (release v1.3 S4)
-- The two supervisor posts, their minimums, which line units each covers, and the demo
-- supervisors' scope (docs/06-data-model.md §3.1; plan .factory/plans/v1.2-supervisors.md §2.1).
--
-- A supervisor post is a unit of kind SUPERVISION (V16), so the schedule, coverage, the planner,
-- gaps, schedule periods and publishing all work on it unchanged. The supervisors who work the
-- posts are seeded by the dataset providers (Datasets 100, 120 and 150), not here.
--
-- The version number follows the merge order: V18 is reserved by the shift-proposals branch, so
-- this file takes V19; nothing else refers to the number.

INSERT INTO unit (id, code, name, kind, allows_12h, allows_16h) VALUES
    ('11111111-1111-1111-1111-000000000007', 'SUP-L', 'Supervision · Living units', 'SUPERVISION', true, false),
    ('11111111-1111-1111-1111-000000000008', 'SUP-O', 'Supervision · Operations',   'SUPERVISION', true, false);

-- One supervisor per block, 24/7, measured hourly like every other unit (ADR-013). The minimums are
-- ordinary requirement rows, edited like any other.
INSERT INTO unit_requirement
    (unit_id, block, min_staff, qualification_id, min_with_qualification, effective_from)
SELECT u.id, v.block, 1, NULL, 0, DATE '2026-10-01'
FROM unit u
CROSS JOIN (VALUES ('DAY'), ('EVENING'), ('NIGHT')) AS v (block)
WHERE u.code IN ('SUP-L', 'SUP-O');

-- SUP-L covers the living units, SUP-O the operations units (display only).
INSERT INTO unit_supervision (supervision_unit_id, unit_id)
SELECT s.id, u.id
FROM unit s
JOIN unit u ON (s.code = 'SUP-L' AND u.code IN ('A', 'B', 'C'))
            OR (s.code = 'SUP-O' AND u.code IN ('ADM', 'CTL', 'ESC'));

-- Both demo supervisors get both posts, so they can relieve each other across areas (owner
-- answer Q2). Their officer-unit scope is unchanged.
INSERT INTO user_unit_scope (user_id, unit_id) VALUES
    ('22222222-2222-2222-2222-000000000001', '11111111-1111-1111-1111-000000000007'),
    ('22222222-2222-2222-2222-000000000001', '11111111-1111-1111-1111-000000000008'),
    ('22222222-2222-2222-2222-000000000002', '11111111-1111-1111-1111-000000000007'),
    ('22222222-2222-2222-2222-000000000002', '11111111-1111-1111-1111-000000000008');
