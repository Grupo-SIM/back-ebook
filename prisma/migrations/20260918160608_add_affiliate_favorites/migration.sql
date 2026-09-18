-- CreateTable
CREATE TABLE "affiliate_favorites" (
    "id" SERIAL NOT NULL,
    "bookId" INTEGER NOT NULL,
    "affiliateId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "affiliate_favorites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "affiliate_favorites_affiliateId_idx" ON "affiliate_favorites"("affiliateId");

-- CreateIndex
CREATE UNIQUE INDEX "affiliate_favorites_affiliateId_bookId_key" ON "affiliate_favorites"("affiliateId", "bookId");

-- AddForeignKey
ALTER TABLE "affiliate_favorites" ADD CONSTRAINT "affiliate_favorites_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "books"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_favorites" ADD CONSTRAINT "affiliate_favorites_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
