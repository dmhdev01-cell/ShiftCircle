-- rule set v4: who can work a post (release v1.3 S2)
-- Owner item 17: supervisors are rostered on their own posts. Two rules say who may work which
-- kind of post, as rows of a new decision table, so a rules admin can change them through the
-- normal draft, approve and publish steps (maker/checker):
--   R-01  a supervisor post needs a supervisor: an officer is blocked with no override, and an
--         officer who holds ACTING_SUP is a warning to acknowledge instead;
--   R-02  a supervisor on an officer post is a warning to acknowledge.
--
-- v4 is published by the same baseline-seeding exception as v2 (V6) and v3 (V12): the published
-- version (v3) becomes history, its rows are copied, and the two new rows are added. Every later
-- edit uses maker/checker. There are no supervisors and no supervisor posts yet, so neither rule can fire
-- on the demo data: every dataset checksum, plan fingerprint and payroll golden is unchanged.
--
-- The version number follows the merge order, after the positions migration (S1).

ALTER TABLE rule_table DROP CONSTRAINT rule_table_code_check;
ALTER TABLE rule_table ADD CONSTRAINT rule_table_code_check
    CHECK (code IN ('REST', 'MAX_HOURS', 'CONSECUTIVE', 'LONG_SHIFTS', 'DAYS_OFF', 'PAY',
                    'OT_RANKING', 'SHIFT_LENGTHS', 'POSTS'));

INSERT INTO rule_table (code, name, template_ref, column_schema) VALUES
    ('POSTS', 'Who can work a post', 'post-eligibility.drt',
     '{"postKind":{"type":"text","label":"Post","enum":["SUPERVISION","LINE"]},
       "allowedPositions":{"type":"array","label":"Who can work it"},
       "actingQualification":{"type":"text","label":"Acting qualification","nullable":true,"enum":["ACTING_SUP"]}}');

-- The base is whichever version is published now (v3 on every database this release meets), not a
-- hard-coded number: exactly one version must be published, or the migration stops.
CREATE TEMPORARY TABLE v17_base AS
    SELECT id, version FROM rule_set_version WHERE status = 'PUBLISHED';

DO $$
BEGIN
    IF (SELECT count(*) FROM v17_base) <> 1 THEN
        RAISE EXCEPTION 'V17 needs exactly one published rule-set version to build v4 on';
    END IF;
END;
$$;

UPDATE rule_set_version SET status = 'SUPERSEDED' WHERE id = (SELECT id FROM v17_base);

INSERT INTO rule_set_version
    (id, version, status, based_on_version, effective_from, change_reason, published_at)
SELECT '00000000-0000-0000-0000-000000000004',
       (SELECT max(version) + 1 FROM rule_set_version), 'PUBLISHED', b.version,
       DATE '2026-11-24',
       'Who can work a post: supervisor posts need a supervisor (owner item 17, release v1.3)',
       TIMESTAMPTZ '2026-11-24 00:00:00+00'
FROM v17_base b;

INSERT INTO rule_row
    (rule_set_version_id, rule_table_id, code, enabled, params, severity, override_policy,
     message, source, is_placeholder, sort_order)
SELECT '00000000-0000-0000-0000-000000000004', rule_table_id, code, enabled, params, severity,
       override_policy, message, source, is_placeholder, sort_order
FROM rule_row
WHERE rule_set_version_id = (SELECT id FROM v17_base);

INSERT INTO rule_row
    (rule_set_version_id, rule_table_id, code, params, severity, override_policy, message, source,
     is_placeholder, sort_order)
SELECT '00000000-0000-0000-0000-000000000004', t.id, v.code, v.params::jsonb, v.severity,
       v.override_policy, v.message, 'Owner item 17', true, v.sort_order
FROM (VALUES
    ('R-01',
     '{"postKind":"SUPERVISION","allowedPositions":["CS"],"actingQualification":"ACTING_SUP"}',
     'BLOCK', 'NONE',
     'A supervisor post needs a supervisor; an officer may work it only with the Acting supervisor qualification, and then it needs an acknowledgement.',
     210),
    ('R-02',
     '{"postKind":"LINE","allowedPositions":["CO"]}',
     'WARN', 'ACKNOWLEDGE',
     'A supervisor is working an officer post; the shift counts toward the unit minimum.',
     220)
) AS v (code, params, severity, override_policy, message, sort_order)
JOIN rule_table t ON t.code = 'POSTS';

DROP TABLE v17_base;
