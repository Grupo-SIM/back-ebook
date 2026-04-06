-- Atualizar todos os livros existentes para maxInstallments=12
UPDATE "books" SET "maxInstallments" = 12 WHERE "maxInstallments" = 1;

-- Mudar o default da coluna para 12
ALTER TABLE "books" ALTER COLUMN "maxInstallments" SET DEFAULT 12;
