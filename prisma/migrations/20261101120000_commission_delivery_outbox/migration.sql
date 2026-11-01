-- A receipt from the legacy endpoint is not a financial acknowledgement.
CREATE TABLE affiliate_commission_deliveries (
    id SERIAL PRIMARY KEY,
    commission_id INTEGER NOT NULL UNIQUE REFERENCES affiliate_commissions(id) ON DELETE RESTRICT,
    protocol TEXT NOT NULL DEFAULT 'LEGACY_RECORD_ONLY' CHECK (protocol = 'LEGACY_RECORD_ONLY'),
    state TEXT NOT NULL DEFAULT 'QUARANTINED' CHECK (state IN ('QUARANTINED', 'PENDING', 'RETRY', 'ACKNOWLEDGED')),
    financial_state TEXT NOT NULL DEFAULT 'UNCONFIRMED' CHECK (financial_state IN ('UNCONFIRMED', 'LEGACY_RECORDED')),
    funding_state TEXT NOT NULL DEFAULT 'UNCONFIRMED' CHECK (funding_state = 'UNCONFIRMED'),
    snapshot JSONB NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    lease_token TEXT,
    lease_until TIMESTAMPTZ,
    last_error TEXT,
    acknowledged_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX affiliate_delivery_retry ON affiliate_commission_deliveries(state, next_attempt_at);
-- No historical recipient/funding reconstruction and no automatic replay.
INSERT INTO affiliate_commission_deliveries (commission_id, snapshot)
SELECT id, jsonb_build_object('historical', true, 'orderId', "orderId", 'bookId', "bookId",
    'affiliateId', "affiliateId", 'amount', "commissionAmount", 'currency', 'BRL')
FROM affiliate_commissions;
CREATE FUNCTION protect_commission_delivery_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.snapshot IS DISTINCT FROM OLD.snapshot OR NEW.commission_id IS DISTINCT FROM OLD.commission_id
        OR NEW.protocol IS DISTINCT FROM OLD.protocol THEN
        RAISE EXCEPTION 'Commission delivery identity and snapshot are immutable';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER immutable_commission_delivery BEFORE UPDATE ON affiliate_commission_deliveries
FOR EACH ROW EXECUTE FUNCTION protect_commission_delivery_snapshot();
