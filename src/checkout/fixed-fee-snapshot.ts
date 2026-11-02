import { randomUUID } from 'node:crypto';

// v1: integer cents; largest remainder descending, lexical immutable item ID ties.
export function allocateFixedFee(grossCents: number, fixedFeeCents: number, items: { itemId: string; sellerId: string | null; grossCents: number }[]) {
    const valid = (n: number) => Number.isSafeInteger(n) && n >= 0;
    if (!valid(grossCents) || grossCents === 0 || !valid(fixedFeeCents) || !items.length
        || items.some(i => !i.itemId || !valid(i.grossCents)) || new Set(items.map(i => i.itemId)).size !== items.length
        || items.reduce((sum, i) => sum + BigInt(i.grossCents), 0n) !== BigInt(grossCents)) {
        throw new Error('Invalid fixed-fee allocation inputs');
    }
    const denominator = BigInt(grossCents);
    const ranked = items.map(item => {
        const numerator = BigInt(item.grossCents) * BigInt(fixedFeeCents);
        return { ...item, fixedFeeCents: Number(numerator / denominator), remainder: numerator % denominator };
    }).sort((a, b) => a.remainder === b.remainder ? (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0) : a.remainder > b.remainder ? -1 : 1);
    const remaining = fixedFeeCents - ranked.reduce((sum, i) => sum + i.fixedFeeCents, 0);
    ranked.forEach((item, index) => { if (index < remaining) item.fixedFeeCents++; });
    return items.map(item => {
        const allocated = ranked.find(i => i.itemId === item.itemId)!;
        return { ...item, fixedFeeCents: allocated.fixedFeeCents };
    });
}

export function moneyToCents(value: number): number {
    const cents = Math.round(value * 100);
    if (!Number.isFinite(value) || value < 0 || !Number.isSafeInteger(cents) || Math.abs(value * 100 - cents) > 0.000001) {
        throw new Error('Money must be a nonnegative integer-cent amount');
    }
    return cents;
}

export function createFixedFeeSnapshot(chargedTotal: number, configuredFee: number, items: { sellerId: string | null; gross: number }[], feeSource = 'UNKNOWN') {
    const chargedTotalCents = moneyToCents(chargedTotal);
    const snapshotItems = items.map(item => ({ itemId: randomUUID(), sellerId: item.sellerId, grossCents: moneyToCents(item.gross) }));
    // Legacy checkout can charge originalPrice while persisting price as item gross.
    // Freeze both facts without redefining the charge or inventing discount allocation.
    const grossCents = snapshotItems.reduce((sum, item) => sum + item.grossCents, 0);
    const configuredFixedFeeCents = moneyToCents(configuredFee);
    const effectiveFixedFeeCents = configuredFixedFeeCents;
    return {
        version: 'fixed-fee-largest-remainder-v1',
        // Finance endpoint exposes no revision: version the captured effective value, not a remote revision.
        configurationVersion: `ebook-fixed-fee-value-v1:${configuredFixedFeeCents}`,
        feeSource,
        sellerAttribution: items.some(item => item.sellerId === null) ? 'UNRESOLVED' : 'KNOWN',
        configuredFixedFeeCents,
        effectiveFixedFeeCents,
        allocationBasis: 'ITEM_GROSS',
        chargedTotalCents,
        grossCents,
        items: allocateFixedFee(grossCents, effectiveFixedFeeCents, snapshotItems),
    };
}
