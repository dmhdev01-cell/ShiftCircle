-- V7__pay_period_dates_unique.sql
-- Review-r2 nit: the same 14-day period must not be created twice. The exclusion
-- constraint already refuses overlapping ranges; this unique index is the explicit
-- defense for an identical start/end pair and makes the intent obvious in the schema.
CREATE UNIQUE INDEX ux_pay_period_dates ON pay_period (start_date, end_date);
