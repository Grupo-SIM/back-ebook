-- Additive only: historical orders remain unknown (NULL). No financial posting changes.
ALTER TABLE orders ADD COLUMN "fixedFeeSnapshot" JSONB;
ALTER TABLE order_items ADD COLUMN "fixedFeeItemId" TEXT;
CREATE UNIQUE INDEX "order_items_fixedFeeItemId_key" ON order_items("fixedFeeItemId");

CREATE FUNCTION protect_fixed_fee_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."fixedFeeSnapshot" IS DISTINCT FROM NEW."fixedFeeSnapshot" THEN
    RAISE EXCEPTION 'fixed fee snapshot is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER immutable_fixed_fee_snapshot BEFORE UPDATE ON orders
FOR EACH ROW EXECUTE FUNCTION protect_fixed_fee_snapshot();

CREATE FUNCTION protect_fixed_fee_item_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."fixedFeeItemId" IS DISTINCT FROM NEW."fixedFeeItemId" THEN
    RAISE EXCEPTION 'fixed fee item identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER immutable_fixed_fee_item_identity BEFORE UPDATE ON order_items
FOR EACH ROW EXECUTE FUNCTION protect_fixed_fee_item_identity();
