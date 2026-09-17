-- CreateEnum
CREATE TYPE "AffiliateCommissionStatus" AS ENUM ('PENDING', 'CREDITED', 'REVERSED');

-- AlterTable
ALTER TABLE "books" ADD COLUMN     "isAffiliate" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "affiliateCode" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "affiliateCode" TEXT;

-- CreateTable
CREATE TABLE "affiliate_commissions" (
    "id" SERIAL NOT NULL,
    "affiliateId" TEXT NOT NULL,
    "bookId" INTEGER NOT NULL,
    "orderId" INTEGER NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "grossAmount" DOUBLE PRECISION NOT NULL,
    "commissionRate" DOUBLE PRECISION NOT NULL,
    "commissionAmount" DOUBLE PRECISION NOT NULL,
    "status" "AffiliateCommissionStatus" NOT NULL DEFAULT 'CREDITED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversedAt" TIMESTAMP(3),

    CONSTRAINT "affiliate_commissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "affiliate_commissions_affiliateId_idx" ON "affiliate_commissions"("affiliateId");

-- CreateIndex
CREATE INDEX "affiliate_commissions_status_idx" ON "affiliate_commissions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "affiliate_commissions_orderId_bookId_key" ON "affiliate_commissions"("orderId", "bookId");

-- CreateIndex
CREATE UNIQUE INDEX "users_affiliateCode_key" ON "users"("affiliateCode");

-- AddForeignKey
ALTER TABLE "affiliate_commissions" ADD CONSTRAINT "affiliate_commissions_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_commissions" ADD CONSTRAINT "affiliate_commissions_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "books"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_commissions" ADD CONSTRAINT "affiliate_commissions_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

