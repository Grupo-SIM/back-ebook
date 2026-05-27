-- AlterTable
ALTER TABLE "users" ADD COLUMN "cnpj" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_cnpj_key" ON "users"("cnpj");
