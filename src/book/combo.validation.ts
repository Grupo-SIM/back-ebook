import { BadRequestException } from '@nestjs/common';

export type ComboMemberCandidate = {
  id: number;
  type: string;
  isActive: boolean;
  createdById: string | null;
};

export function validateComboBookIds(
  bookIds: number[],
  sellerId: string,
  books: ComboMemberCandidate[],
): void {
  if (bookIds.length < 2) {
    throw new BadRequestException('A combo must contain at least two books');
  }

  if (new Set(bookIds).size !== bookIds.length) {
    throw new BadRequestException('A combo cannot contain a duplicate book');
  }

  if (books.length !== bookIds.length) {
    throw new BadRequestException('One or more combo books do not exist');
  }

  for (const book of books) {
    if (book.type !== 'SINGLE') {
      throw new BadRequestException('A combo can only contain single books');
    }
    if (!book.isActive) {
      throw new BadRequestException('A combo cannot contain an inactive book');
    }
    if (book.createdById !== sellerId) {
      throw new BadRequestException('A combo cannot contain a foreign seller book');
    }
  }
}
