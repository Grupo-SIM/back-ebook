/*
  Warnings:

  - You are about to drop the column `pageCount` on the `books` table. All the data in the column will be lost.
  - The `format` column on the `books` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "BookFormat" AS ENUM ('PDF', 'EPUB', 'MOBI');

-- AlterTable
ALTER TABLE "books" DROP COLUMN "pageCount",
ADD COLUMN     "printLength" INTEGER,
DROP COLUMN "format",
ADD COLUMN     "format" "BookFormat";
