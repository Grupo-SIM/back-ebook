-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "affiliateProductLinkId" INTEGER;

-- CreateTable
CREATE TABLE "affiliate_product_links" (
    "id" SERIAL NOT NULL,
    "bookId" INTEGER NOT NULL,
    "affiliateId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "affiliate_product_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "affiliate_product_links_code_key" ON "affiliate_product_links"("code");

-- CreateIndex
CREATE INDEX "affiliate_product_links_code_idx" ON "affiliate_product_links"("code");

-- CreateIndex
CREATE INDEX "affiliate_product_links_affiliateId_idx" ON "affiliate_product_links"("affiliateId");

-- CreateIndex
CREATE UNIQUE INDEX "affiliate_product_links_bookId_affiliateId_key" ON "affiliate_product_links"("bookId", "affiliateId");

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_affiliateProductLinkId_fkey" FOREIGN KEY ("affiliateProductLinkId") REFERENCES "affiliate_product_links"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_product_links" ADD CONSTRAINT "affiliate_product_links_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "books"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_product_links" ADD CONSTRAINT "affiliate_product_links_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
