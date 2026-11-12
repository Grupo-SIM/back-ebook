import { validateComboBookIds } from './combo.validation';

describe('validateComboBookIds', () => {
  it('accepts two unique active single books owned by the combo seller', () => {
    expect(() => validateComboBookIds(
      [11, 22],
      'seller-1',
      [
        { id: 11, type: 'SINGLE', isActive: true, createdById: 'seller-1' },
        { id: 22, type: 'SINGLE', isActive: true, createdById: 'seller-1' },
      ],
    )).not.toThrow();
  });

  it.each([
    [[11], 'at least two books'],
    [[11, 11], 'duplicate book'],
    [[11, 22], 'foreign seller'],
  ])('rejects invalid combo membership', (ids, reason) => {
    const books = reason === 'foreign seller'
      ? [
          { id: 11, type: 'SINGLE', isActive: true, createdById: 'seller-1' },
          { id: 22, type: 'SINGLE', isActive: true, createdById: 'seller-2' },
        ]
      : [
          { id: 11, type: 'SINGLE', isActive: true, createdById: 'seller-1' },
          { id: 22, type: 'SINGLE', isActive: true, createdById: 'seller-1' },
        ];

    expect(() => validateComboBookIds(ids, 'seller-1', books)).toThrow(reason);
  });
});
