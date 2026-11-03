type Product = { id: number; createdById: string | null; isAffiliate: boolean; commissionRate?: number | null };
type Link = { id: number; bookId: number; affiliateId: string; code: string };

/** Checkout evidence only; missing rates remain unconfirmed, never a historical backfill. */
export function createAffiliateAttribution(book: Product, link: Link | null, buyerId: string) {
    const eligible = book.isAffiliate && link?.bookId === book.id;
    const rate = book.commissionRate ?? null;
    if (eligible && ((rate !== null && (!Number.isFinite(rate) || rate < 0 || rate > 100)) || !book.createdById)) {
        throw new Error('Invalid affiliate checkout attribution');
    }
    return {
        version: 1, bookId: book.id, ownerId: book.createdById, buyerId,
        affiliateId: eligible ? link.affiliateId : null,
        linkId: eligible ? link.id : null, code: eligible ? link.code : null,
        commissionRate: eligible ? rate : null,
        rateSource: eligible ? (book.commissionRate == null ? 'UNCONFIRMED' : 'BOOK') : null,
    };
}

export function readAffiliateAttribution(value: unknown) {
    if (!value || typeof value !== 'object') throw new Error('Legacy/unconfirmed affiliate attribution');
    const snapshot = value as ReturnType<typeof createAffiliateAttribution>;
    if (snapshot.version !== 1 || !Number.isSafeInteger(snapshot.bookId) || !snapshot.buyerId
        || (snapshot.affiliateId !== null && (typeof snapshot.affiliateId !== 'string' || !snapshot.affiliateId
            || typeof snapshot.ownerId !== 'string' || !snapshot.ownerId
            || !Number.isSafeInteger(snapshot.linkId) || !snapshot.code
            || !((snapshot.rateSource === 'UNCONFIRMED' && snapshot.commissionRate === null)
                || (snapshot.rateSource === 'BOOK' && typeof snapshot.commissionRate === 'number'
                    && Number.isFinite(snapshot.commissionRate) && snapshot.commissionRate >= 0 && snapshot.commissionRate <= 100))))
        || (snapshot.affiliateId === null && [snapshot.linkId, snapshot.code, snapshot.commissionRate, snapshot.rateSource].some(value => value !== null))) {
        throw new Error('Invalid frozen affiliate attribution');
    }
    return snapshot;
}
