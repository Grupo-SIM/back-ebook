-- AlterTable
ALTER TABLE "books" ADD COLUMN     "coverImageId" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "avatarImageId" TEXT;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_avatarImageId_fkey" FOREIGN KEY ("avatarImageId") REFERENCES "Image"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "books" ADD CONSTRAINT "books_coverImageId_fkey" FOREIGN KEY ("coverImageId") REFERENCES "Image"("id") ON DELETE SET NULL ON UPDATE CASCADE;
