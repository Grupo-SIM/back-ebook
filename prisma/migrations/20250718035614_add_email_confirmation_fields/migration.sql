-- AlterTable
ALTER TABLE "users" ADD COLUMN     "emailConfirmationCode" TEXT,
ADD COLUMN     "emailConfirmed" BOOLEAN NOT NULL DEFAULT false;
