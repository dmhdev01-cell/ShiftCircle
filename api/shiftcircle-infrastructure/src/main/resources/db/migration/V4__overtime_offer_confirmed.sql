-- The supervisor's confirmation completes an overtime offer (docs/07 §4.3, step 8). An accepted
-- offer is confirmed by a supervisor, and that is the state the web shows as "Confirmed".
ALTER TABLE overtime_offer DROP CONSTRAINT overtime_offer_status_check;

ALTER TABLE overtime_offer ADD CONSTRAINT overtime_offer_status_check
    CHECK (status IN ('OFFERED', 'ACCEPTED', 'DECLINED', 'CONFIRMED', 'WITHDRAWN', 'EXPIRED'));
