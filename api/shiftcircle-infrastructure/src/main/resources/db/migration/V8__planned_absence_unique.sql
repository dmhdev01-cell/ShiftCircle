-- P3-3 (review-r3): one planned absence per officer-day.
--
-- The planner's POST /planner/absences is a read-then-insert; concurrent calls for the same
-- officer and date could insert several rows (observed four in a race). The pre-check still gives
-- the friendly 200/409 answer; this index is the database guarantee.
--
-- Only planner absences are covered (shift_assignment_id IS NULL). The seeded roster absences are
-- attached to a shift and may legitimately have more than one row for an officer on a date (for
-- example a sick shift and a vacation entry on another shift).
--
-- Dedupe first, keeping the earliest recorded row (ties by id). These rows are demo plans, not
-- audited records; the 100/120 dataset checksums cover assignments and periods, not absences.
DELETE FROM absence a
USING absence b
WHERE a.shift_assignment_id IS NULL
  AND b.shift_assignment_id IS NULL
  AND a.employee_id = b.employee_id
  AND a.start_at = b.start_at
  AND a.end_at = b.end_at
  AND (a.recorded_at, a.id) > (b.recorded_at, b.id);

CREATE UNIQUE INDEX ux_absence_planned_officer_day
    ON absence (employee_id, start_at, end_at)
    WHERE shift_assignment_id IS NULL;
