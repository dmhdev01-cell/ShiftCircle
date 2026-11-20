-- V2__reference_data.sql
-- Reference data for the prototype (docs/06-data-model.md §6): qualifications, the eight rule
-- tables, rule set v1 from docs/05-union-rules.md, and the configurable shift templates (ADR-015).
--
-- Values marked is_placeholder = true are invented for the prototype and need validation by someone
-- who works in a correctional centre (docs/05 §6). Severity and override policy are per row so a
-- rules admin can change them without a code change.

INSERT INTO qualification (code, name) VALUES
    ('CONTROL', 'Control room'),
    ('ESCORT', 'Escort and transport'),
    ('FIRST_AID', 'First aid');

-- ---------------------------------------------------------------------------------------------
-- Rule tables: the friendly columns each screen shows (docs/04 §5)
-- ---------------------------------------------------------------------------------------------

INSERT INTO rule_table (code, name, template_ref, column_schema) VALUES
    ('REST', 'Rest between shifts', 'rest-between-shifts.drt',
     '{"afterShiftKind":{"type":"text","label":"After this kind of shift","default":".*"},
       "windowHours":{"type":"int","label":"Within (hours)"},
       "minRestHours":{"type":"number","label":"At least (hours) off","minimum":8}}'),
    ('MAX_HOURS', 'Maximum hours', 'max-hours-in-window.drt',
     '{"windowHours":{"type":"int","label":"Window (hours)"},
       "warnAtHours":{"type":"number","label":"Warn at (hours)","nullable":true},
       "maxHours":{"type":"number","label":"Maximum (hours)"}}'),
    ('CONSECUTIVE', 'Consecutive work', 'max-consecutive.drt',
     '{"counts":{"type":"text","label":"What is counted","enum":["DAYS","SHIFTS_12H","SHIFTS_NIGHT_12H"]},
       "max":{"type":"int","label":"Maximum"},
       "overtimeSeverity":{"type":"text","label":"When caused by overtime","enum":["BLOCK","WARN"],"default":"WARN"}}'),
    ('LONG_SHIFTS', '16-hour shifts', 'long-shifts-in-window.drt',
     '{"maxIn7Days":{"type":"int","label":"Max in 7 days"},
       "maxIn28Days":{"type":"int","label":"Max in 28 days"}}'),
    ('DAYS_OFF', 'Days off', 'min-consecutive-days-off.drt',
     '{"daysOff":{"type":"int","label":"Days off required"},
       "withinDays":{"type":"int","label":"Within how many days"},
       "minBreakHours":{"type":"int","label":"Minimum length of a day off (hours)"}}'),
    ('PAY', 'Pay classification', 'pay-classification.drt',
     '{"thresholdWindow":{"type":"text","label":"Threshold window","enum":["WEEK","PAY_PERIOD"]},
       "thresholdHours":{"type":"number","label":"Threshold (hours)"},
       "paidLeaveCounts":{"type":"boolean","label":"Paid leave counts toward the threshold"},
       "otRate":{"type":"number","label":"Overtime multiplier"},
       "ignoreUnderMinutes":{"type":"int","label":"Overtime under (minutes) is unpaid","nullable":true}}'),
    ('OT_RANKING', 'Overtime ranking', 'overtime-ranking.drt',
     '{"orderBy":{"type":"array","label":"Sort order"},
       "skipIfBlocked":{"type":"boolean","label":"Skip officers who would break a block rule"},
       "keepPlace":{"type":"boolean","label":"Skipped officers keep their place"}}'),
    ('SHIFT_LENGTHS', 'Shift types', 'shift-lengths.drt',
     '{"allowedLengths":{"type":"array","label":"Allowed regular lengths (hours)"},
       "requireUnitFlagFor":{"type":"array","label":"Lengths that need a local agreement on the unit"}}');

-- ---------------------------------------------------------------------------------------------
-- Rule set v1 — published 1 Oct 2026. Must-implement rules from docs/05 §3.
-- ---------------------------------------------------------------------------------------------

INSERT INTO rule_set_version
    (id, version, status, effective_from, change_reason, published_at)
VALUES
    ('00000000-0000-0000-0000-000000000001', 1, 'PUBLISHED', DATE '2026-10-01',
     'Initial rule set from the mock agreement', TIMESTAMPTZ '2026-10-01 08:00:00+00');

INSERT INTO rule_row
    (rule_set_version_id, rule_table_id, code, params, severity, override_policy, message, source,
     is_placeholder, sort_order)
SELECT '00000000-0000-0000-0000-000000000001', t.id, v.code, v.params::jsonb, v.severity,
       v.override_policy, v.message, v.source, v.is_placeholder, v.sort_order
FROM (
    VALUES
    -- A. Rest and fatigue
    ('REST', 'U-01',
     '{"afterShiftKind":".*","windowHours":24,"minExtensionMinutes":0,"minRestHours":8}',
     'BLOCK', 'EMERGENCY',
     'Less than 8 hours rest in 24 hours (Employment Act minimum).', 'SEA', false, 10),
    ('REST', 'U-02',
     '{"afterShiftKind":"(D8|E8|N8|A12|P12)","windowHours":24,"minExtensionMinutes":0,"minRestHours":12}',
     'WARN', 'ACKNOWLEDGE',
     'Less than the 12-hour rest target between shifts.', 'MOCK', true, 20),
    ('REST', 'U-03',
     '{"afterShiftKind":"L16","windowHours":24,"minExtensionMinutes":0,"minRestHours":12}',
     'BLOCK', 'EMERGENCY',
     'Needs 12 hours off after a 16-hour shift.', 'MOCK', true, 30),
    ('REST', 'U-04',
     '{"afterShiftKind":".*","windowHours":24,"minExtensionMinutes":240,"minRestHours":10}',
     'WARN', 'ACKNOWLEDGE',
     'Short rest after an overtime extension of 4 hours or more.', 'MOCK', true, 40),
    -- C. Hours over a period
    ('MAX_HOURS', 'U-05',
     '{"windowHours":24,"maxHours":16}',
     'BLOCK', 'EMERGENCY',
     'More than 16 hours worked in 24 hours (Employment Act limit).', 'SEA', false, 50),
    ('MAX_HOURS', 'U-14',
     '{"windowHours":168,"warnAtHours":48,"maxHours":60}',
     'BLOCK', 'ACKNOWLEDGE',
     'Weekly hours above the 48-hour warning level or the 60-hour ceiling.', 'MOCK', true, 60),
    -- B. Consecutive work
    ('CONSECUTIVE', 'U-08',
     '{"counts":"DAYS","max":7,"overtimeSeverity":"WARN"}',
     'BLOCK', 'ACKNOWLEDGE',
     'More than 7 consecutive work days.', 'NWT; NU', true, 80),
    ('CONSECUTIVE', 'U-09',
     '{"counts":"SHIFTS_12H","max":4,"overtimeSeverity":"WARN"}',
     'BLOCK', 'ACKNOWLEDGE',
     'More than 4 consecutive 12-hour shifts.', 'MOCK', true, 90),
    ('CONSECUTIVE', 'U-10',
     '{"counts":"SHIFTS_NIGHT_12H","max":4,"overtimeSeverity":"WARN"}',
     'WARN', 'ACKNOWLEDGE',
     'More than 4 consecutive overnight 00-12 shifts.', 'MOCK', true, 100),
    ('LONG_SHIFTS', 'U-11',
     '{"maxIn7Days":3,"maxIn28Days":10}',
     'WARN', 'ACKNOWLEDGE',
     'Too many 16-hour shifts in a rolling window.', 'MOCK', true, 110),
    ('DAYS_OFF', 'U-12',
     '{"daysOff":2,"withinDays":7,"minBreakHours":24}',
     'WARN', 'ACKNOWLEDGE',
     'Fewer than 2 consecutive days off in 7 days.', 'CX; PSGE; NU', true, 120),
    -- D. Pay classification (docs/05 §2.D)
    ('PAY', 'P-01',
     '{"thresholdWindow":"PAY_PERIOD","thresholdHours":80,"paidLeaveCounts":false}',
     'INFO', 'NONE',
     'Hours beyond 80 in a two-week pay period are overtime.', 'SEA; PSGE', true, 140),
    ('PAY', 'P-01b',
     '{"otRate":1.5}',
     'INFO', 'NONE',
     'Overtime hours are paid at 1.5 times the regular rate.', 'MOCK', true, 150),
    ('PAY', 'P-04',
     '{"ignoreUnderMinutes":30}',
     'INFO', 'NONE',
     'Overtime under 30 minutes is not paid.', 'PSGE', true, 160),
    -- F. Overtime allocation
    ('OT_RANKING', 'O-01',
     '{"orderBy":["OT_HOURS_QUARTER_ASC","SENIORITY_ASC"],"skipIfBlocked":true,"keepPlace":true}',
     'INFO', 'NONE',
     'Offer overtime equitably among available, qualified officers.', 'CX', true, 170),
    ('OT_RANKING', 'O-02',
     '{"orderBy":["OT_HOURS_QUARTER_ASC","SENIORITY_ASC"]}',
     'INFO', 'NONE',
     'Fewest overtime hours this quarter first, ties broken by seniority.', 'MOCK', true, 180),
    ('OT_RANKING', 'O-03',
     '{"skipIfBlocked":true,"keepPlace":true}',
     'INFO', 'NONE',
     'Officers who would break a block rule are skipped and not penalised.', 'MOCK', true, 190),
    -- G. Shift lengths and unit eligibility
    ('SHIFT_LENGTHS', 'L-01',
     '{"allowedLengths":[8,12,16]}',
     'BLOCK', 'NONE',
     'Only 8, 12 and 16-hour shifts; longer patterns need a local agreement on the unit.',
     'Lead direction; PSGE', false, 200),
    ('SHIFT_LENGTHS', 'S-03',
     '{"requireUnitFlagFor":[12,16]}',
     'BLOCK', 'NONE',
     '12- and 16-hour patterns are allowed only on units with a local agreement.', 'PSGE', true, 210)
) AS v (table_code, code, params, severity, override_policy, message, source, is_placeholder,
        sort_order)
JOIN rule_table t ON t.code = v.table_code;

-- ---------------------------------------------------------------------------------------------
-- Shift templates (ADR-015). Changing these never alters existing assignments, which keep their
-- own start_at/end_at; the change goes through the rules draft → approve → publish flow.
-- ---------------------------------------------------------------------------------------------

INSERT INTO shift_template
    (code, label, start_time, duration_minutes, regular_allowed, chip_style, effective_from,
     rule_set_version_id)
VALUES
    ('D8', 'Day 8 h', TIME '07:00', 480, true, 'day', DATE '2026-10-01',
     '00000000-0000-0000-0000-000000000001'),
    ('E8', 'Evening 8 h', TIME '15:00', 480, true, 'evening', DATE '2026-10-01',
     '00000000-0000-0000-0000-000000000001'),
    ('N8', 'Night 8 h', TIME '23:00', 480, true, 'night', DATE '2026-10-01',
     '00000000-0000-0000-0000-000000000001'),
    ('A12', 'Overnight 12 h', TIME '00:00', 720, true, 'night', DATE '2026-10-01',
     '00000000-0000-0000-0000-000000000001'),
    ('P12', 'Afternoon 12 h', TIME '12:00', 720, true, 'evening', DATE '2026-10-01',
     '00000000-0000-0000-0000-000000000001'),
    ('L16', 'Long 16 h', TIME '20:00', 960, true, 'long', DATE '2026-10-01',
     '00000000-0000-0000-0000-000000000001');
