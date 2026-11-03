ALTER TABLE affiliate_commissions ADD COLUMN "settlementManifestId" UUID;

CREATE TABLE "ebook_settlement_manifests" (
  "manifestId" UUID PRIMARY KEY,
  "orderId" INTEGER NOT NULL UNIQUE REFERENCES "orders"("id"),
  "manifest" JSONB NOT NULL,
  "settlementId" TEXT UNIQUE,
  "manifestHash" TEXT,
  "revision" INTEGER NOT NULL DEFAULT -1,
  "projection" JSONB,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE "ebook_settlement_receipts" (
  "receiptId" TEXT PRIMARY KEY,
  "manifestId" UUID NOT NULL REFERENCES "ebook_settlement_manifests"("manifestId"),
  "revision" INTEGER NOT NULL,
  "receipt" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE ("manifestId", "revision")
);

CREATE FUNCTION ebook_settlement_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'ebook_settlement_receipts' THEN
    RAISE EXCEPTION 'Settlement receipts are immutable';
  END IF;
  IF TG_OP = 'DELETE' OR NEW."manifestId" IS DISTINCT FROM OLD."manifestId"
     OR NEW."orderId" IS DISTINCT FROM OLD."orderId" OR NEW.manifest IS DISTINCT FROM OLD.manifest
     OR (OLD."settlementId" IS NOT NULL AND NEW."settlementId" IS DISTINCT FROM OLD."settlementId")
     OR (OLD."manifestHash" IS NOT NULL AND NEW."manifestHash" IS DISTINCT FROM OLD."manifestHash")
     OR NEW.revision < OLD.revision THEN
    RAISE EXCEPTION 'Settlement manifest identity and history are immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER ebook_manifest_immutable BEFORE UPDATE OR DELETE ON ebook_settlement_manifests
FOR EACH ROW EXECUTE FUNCTION ebook_settlement_immutable();
CREATE TRIGGER ebook_receipt_immutable BEFORE UPDATE OR DELETE ON ebook_settlement_receipts
FOR EACH ROW EXECUTE FUNCTION ebook_settlement_immutable();
