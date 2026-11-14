-- Durable retry of the SimIntPay pending entry (POST finance/entries kind=pending) of an Ebook order.
-- Additive only. One row per order (idempotent enqueue); the entry itself is idempotent by orderNumber in SimIntPay.
CREATE TABLE ebook_pending_entry_deliveries (
    id SERIAL PRIMARY KEY,
    order_number TEXT NOT NULL UNIQUE,
    state TEXT NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING', 'RETRY', 'ACKNOWLEDGED', 'SKIPPED')),
    snapshot JSONB NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    lease_token TEXT,
    lease_until TIMESTAMPTZ,
    last_error TEXT,
    acknowledged_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ebook_pending_entry_retry ON ebook_pending_entry_deliveries(state, next_attempt_at);
