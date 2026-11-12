CREATE TYPE "BookType" AS ENUM ('SINGLE', 'COMBO');

ALTER TABLE "books"
ADD COLUMN "type" "BookType" NOT NULL DEFAULT 'SINGLE';

CREATE TABLE "book_combo_items" (
  "id" SERIAL NOT NULL,
  "comboId" INTEGER NOT NULL,
  "bookId" INTEGER NOT NULL,
  "position" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "book_combo_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "order_combo_books" (
  "id" SERIAL NOT NULL,
  "orderItemId" INTEGER NOT NULL,
  "bookId" INTEGER NOT NULL,
  "position" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "order_combo_books_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "book_combo_items_comboId_bookId_key" ON "book_combo_items"("comboId", "bookId");
CREATE UNIQUE INDEX "book_combo_items_comboId_position_key" ON "book_combo_items"("comboId", "position");
CREATE INDEX "book_combo_items_bookId_idx" ON "book_combo_items"("bookId");
CREATE UNIQUE INDEX "order_combo_books_orderItemId_bookId_key" ON "order_combo_books"("orderItemId", "bookId");
CREATE UNIQUE INDEX "order_combo_books_orderItemId_position_key" ON "order_combo_books"("orderItemId", "position");
CREATE INDEX "order_combo_books_bookId_idx" ON "order_combo_books"("bookId");

ALTER TABLE "book_combo_items"
ADD CONSTRAINT "book_combo_items_comboId_fkey" FOREIGN KEY ("comboId") REFERENCES "books"("id") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "book_combo_items_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "books"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "order_combo_books"
ADD CONSTRAINT "order_combo_books_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "order_combo_books_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "books"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
