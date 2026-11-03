import { BadRequestException, ConflictException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';

export function canonicalManifest(value: any): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonicalManifest).join(',')}]`;
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalManifest(value[key])}`).join(',')}}`;
}

export function manifestHash(value: any): string {
    return createHash('sha256').update(canonicalManifest(value)).digest('hex');
}
import { readAffiliateAttribution } from '../affiliate/affiliate-attribution';

// Persistence deliberately uses parameterized SQL: no checked-in generated client edits.
export async function prepareSettlement(prisma: any, orderId: number) {
    return prisma.$transaction(async (tx: any) => {
        await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId} FOR UPDATE`;
        const existing = await tx.$queryRaw`SELECT * FROM ebook_settlement_manifests WHERE "orderId" = ${orderId}`;
        if (existing.length) return existing[0].manifest;
        const legacy = await tx.affiliateCommission.findFirst({ where: { orderId } });
        if (legacy) throw new ConflictException('Legacy commission exists; settlement enrollment blocked');
        const order = await tx.order.findUnique({ where: { id: orderId }, include: { orderItems: true } });
        if (!order?.fixedFeeSnapshot) throw new BadRequestException('Settlement requires frozen checkout evidence');
        const fee = order.fixedFeeSnapshot;
        const cents = (value: number) => {
            const n = Math.round(value * 100);
            if (!Number.isSafeInteger(n) || n < 0 || Math.abs(value * 100 - n) > 0.000001) throw new BadRequestException('Invalid frozen gross');
            return n;
        };
        const validDocument = (document: string) => {
            if (!/^(\d{11}|\d{14})$/.test(document) || /^(\d)\1+$/.test(document)) return false;
            const digit = (base: string, weights: number[]) => {
                const remainder = [...base].reduce((sum, n, index) => sum + Number(n) * weights[index], 0) % 11;
                return remainder < 2 ? 0 : 11 - remainder;
            };
            const firstWeights = document.length === 11 ? [10,9,8,7,6,5,4,3,2] : [5,4,3,2,9,8,7,6,5,4,3,2];
            const secondWeights = document.length === 11 ? [11,10,9,8,7,6,5,4,3,2] : [6,5,4,3,2,9,8,7,6,5,4,3,2];
            return digit(document.slice(0, -2), firstWeights) === Number(document.at(-2)) && digit(document.slice(0, -1), secondWeights) === Number(document.at(-1));
        };
        const identity = async (id: string, required = true) => {
            const user = id ? await tx.user.findUnique({ where: { id } }) : null;
            const document = (user?.cnpj || user?.cpf || '').replace(/\D/g, '');
            if (required && !validDocument(document)) throw new BadRequestException('Settlement beneficiary document missing');
            return { externalUserId: id, document: document || null };
        };
        const items = [];
        for (const item of order.orderItems) {
            const attribution = readAffiliateAttribution(item.affiliateAttribution);
            const frozen = fee.items?.find((entry: any) => entry.itemId === item.fixedFeeItemId);
            const grossCents = cents(item.totalPrice);
            if (!frozen || frozen.grossCents !== grossCents || attribution.bookId !== item.bookId || attribution.buyerId !== order.userId || frozen.sellerId !== attribution.ownerId) throw new BadRequestException('Frozen item mismatch');
            let affiliate = null;
            if (attribution.affiliateId) {
                const rate = attribution.commissionRate;
                if (rate == null || !Number.isSafeInteger(rate * 100)) throw new BadRequestException('Unconfirmed affiliate rate');
                affiliate = { ...await identity(attribution.affiliateId), linkId: attribution.linkId, linkCode: attribution.code, commissionRateBps: rate * 100 };
            }
            items.push({ itemId: item.fixedFeeItemId, productId: item.bookId, quantity: item.quantity, grossCents, fixedFeeCents: frozen.fixedFeeCents, owner: await identity(attribution.ownerId), affiliate, buyer: await identity(order.userId, false) });
        }
        if (new Set(items.map(item => item.productId)).size !== items.length) throw new BadRequestException('Duplicate product items require item-scoped affiliate projection');
        const grossCents = cents(order.totalAmount);
        if (!items.length || items.reduce((s, i) => s + i.grossCents, 0) !== grossCents || fee.chargedTotalCents !== grossCents || items.reduce((s, i) => s + i.fixedFeeCents, 0) !== fee.effectiveFixedFeeCents) throw new BadRequestException('Order gross mismatch; customer price unchanged');
        const manifest = { version: 1, manifestId: randomUUID(), orderId: order.id, orderNumber: order.orderNumber, currency: 'BRL', grossCents, items, fixedFeeSnapshot: fee };
        await tx.$executeRaw`INSERT INTO ebook_settlement_manifests ("manifestId", "orderId", manifest) VALUES (${manifest.manifestId}::uuid, ${orderId}, ${JSON.stringify(manifest)}::jsonb)`;
        return manifest;
    });
}

export async function bindSettlement(prisma: any, manifestId: string, settlementId: string, hash: string) {
    if (typeof settlementId !== 'string' || !settlementId || typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) throw new BadRequestException('Invalid enrollment response');
    const rows = await prisma.$queryRaw`SELECT manifest FROM ebook_settlement_manifests WHERE "manifestId" = ${manifestId}::uuid`;
    if (!rows.length || manifestHash(rows[0].manifest) !== hash) throw new ConflictException('Enrollment manifest hash mismatch');
    const count = await prisma.$executeRaw`UPDATE ebook_settlement_manifests SET "settlementId" = ${settlementId}, "manifestHash" = ${hash} WHERE "manifestId" = ${manifestId}::uuid AND ("settlementId" IS NULL OR "settlementId" = ${settlementId}) AND ("manifestHash" IS NULL OR "manifestHash" = ${hash})`;
    if (count !== 1) throw new ConflictException('Enrollment binding conflict');
}
