/*
  Warnings:

  - You are about to drop the column `format` on the `books` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "books" DROP COLUMN "format";

-- DropEnum
DROP TYPE "BookFormat";
