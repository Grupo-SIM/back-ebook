import { readAffiliateAttribution } from './affiliate-attribution';
import { moneyToCents } from '../checkout/fixed-fee-snapshot';

type Association = {
    id: number; orderId: number; bookId: number; quantity: number; unitPrice: number; totalPrice: number;
    affiliateAttribution?: unknown;
    affiliateProductLinkId?: number | null;
    order: { orderNumber: string; userId?: string };
    book: { createdById: string | null };
    affiliateProductLink: { affiliateId: string; code: string } | null;
};

/** Evidence only. Seller funding expresses intent, never proof of a debit. */
export function validateCommissionEvidence(rows: Association[], expected: {
    orderId: number; orderNumber: string; bookId: number; sellerId: string | null;
    affiliateId: string; code: string; grossAmount: number; commissionAmount: number;
    commissionRate: number; buyerId?: string;
}) {
    // The legacy calculation is per input item, not an aggregate of same-book rows.
    // Ambiguous associations must not silently change that calculation.
    if (rows.length !== 1) throw new Error('Ambiguous or missing persisted commission item');
    const row = rows[0];
    const attribution = readAffiliateAttribution(row.affiliateAttribution);
    if (attribution.bookId !== row.bookId || attribution.buyerId !== row.order.userId
        || attribution.linkId !== row.affiliateProductLinkId
        || attribution.ownerId !== expected.sellerId || attribution.affiliateId !== expected.affiliateId
        || attribution.code !== expected.code || attribution.commissionRate !== expected.commissionRate
        || (expected.buyerId !== undefined && attribution.buyerId !== expected.buyerId)
        || attribution.buyerId === attribution.affiliateId || attribution.ownerId === attribution.affiliateId
        || moneyToCents(expected.commissionAmount) !== moneyToCents(parseFloat((row.totalPrice * attribution.commissionRate / 100).toFixed(2)))) {
        throw new Error('Frozen affiliate attribution mismatch');
    }
    if (row.orderId !== expected.orderId || row.bookId !== expected.bookId
        || row.order.orderNumber !== expected.orderNumber || !expected.sellerId
        || !Number.isSafeInteger(row.quantity) || row.quantity <= 0) {
        throw new Error('Persisted commission association mismatch');
    }
    const unitPriceCents = moneyToCents(row.unitPrice);
    const grossCents = moneyToCents(row.totalPrice);
    const commissionCents = moneyToCents(expected.commissionAmount);
    if (BigInt(unitPriceCents) * BigInt(row.quantity) !== BigInt(grossCents)
        || grossCents !== moneyToCents(expected.grossAmount)) {
        throw new Error('Persisted commission monetary mismatch');
    }
    return {
        evidenceVersion: 2,
        attribution,
        orderItems: [{ id: row.id, quantity: row.quantity, unitPrice: row.unitPrice, totalPrice: row.totalPrice,
            unitPriceCents, grossCents }],
        grossCents, commissionCents,
    };
}
