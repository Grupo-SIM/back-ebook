/*
  Warnings:

  - A unique constraint covering the columns `[userId,bookId]` on the table `favorites` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "favorites_bookId_key";

-- AlterTable
ALTER TABLE "favorites" ADD COLUMN     "userId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "favorites_userId_bookId_key" ON "favorites"("userId", "bookId");

-- AddForeignKey
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
