/*
  Warnings:

  - You are about to drop the column `userId` on the `favorites` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[bookId]` on the table `favorites` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE "favorites" DROP CONSTRAINT "favorites_userId_fkey";

-- DropIndex
DROP INDEX "favorites_userId_bookId_key";

-- AlterTable
ALTER TABLE "favorites" DROP COLUMN "userId";

-- CreateIndex
CREATE UNIQUE INDEX "favorites_bookId_key" ON "favorites"("bookId");
