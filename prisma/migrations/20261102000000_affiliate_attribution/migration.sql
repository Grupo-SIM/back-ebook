ALTER TABLE "order_items" ADD COLUMN "affiliateAttribution" JSONB;

-- Never backfill historical attribution, including when it was absent at checkout.
CREATE FUNCTION protect_affiliate_attribution() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW."affiliateAttribution" IS DISTINCT FROM OLD."affiliateAttribution" THEN
        RAISE EXCEPTION 'Affiliate attribution is immutable';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER order_item_affiliate_attribution_immutable
BEFORE UPDATE ON "order_items" FOR EACH ROW EXECUTE FUNCTION protect_affiliate_attribution();
