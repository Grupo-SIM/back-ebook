-- AlterTable
ALTER TABLE "books" ADD COLUMN     "downloadCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "downloadUrl" TEXT,
ADD COLUMN     "fileSize" TEXT,
ADD COLUMN     "format" TEXT,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "isFeatured" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isFree" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isbn" TEXT,
ADD COLUMN     "language" TEXT,
ADD COLUMN     "pageCount" INTEGER,
ADD COLUMN     "publishedDate" TEXT,
ADD COLUMN     "publisher" TEXT;
