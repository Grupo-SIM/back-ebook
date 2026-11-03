import { BadRequestException, Body, ConflictException, Controller, Headers, Post, UnauthorizedException } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import { manifestHash } from './ebook-settlement';
import { PrismaService } from 'prisma/prisma.service';

function canonical(value: any): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}

@Controller('internal/ebook/settlements')
export class SettlementReceiptsController {
    constructor(private readonly prisma: PrismaService) {}

    @Post('receipts')
    async receive(@Headers('x-internal-token') token: string, @Body() receipt: any) {
        const expected = process.env.API_MACHINE_INTERNAL_TOKEN;
        if (!expected || typeof token !== 'string' || !timingSafeEqual(createHash('sha256').update(token).digest(), createHash('sha256').update(expected).digest())) throw new UnauthorizedException();
        const text = (value: unknown) => typeof value === 'string' && value.length > 0;
        const money = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
        if (!receipt || receipt.version !== 1 || !text(receipt.receiptId) || !text(receipt.settlementId)
            || !/^[0-9a-f-]{36}$/i.test(receipt.manifestId ?? '') || !/^[0-9a-f]{64}$/.test(receipt.manifestHash ?? '')
            || !Number.isSafeInteger(receipt.orderId) || !text(receipt.orderNumber) || !text(receipt.transactionId)
            || !Number.isSafeInteger(receipt.revision) || receipt.revision < 0 || !money(receipt.grossCents)
            || !['PENDING', 'SETTLED', 'LOCKED', 'BLOCKED', 'REVERSED'].includes(receipt.status)
            || !Array.isArray(receipt.allocations)) throw new BadRequestException('Invalid settlement receipt');
        const ids = new Set();
        for (const a of receipt.allocations) {
            if (!a || !text(a.allocationId) || ids.has(a.allocationId) || !text(a.itemId) || !text(a.beneficiaryId)
                || !['OWNER', 'AFFILIATE', 'COPRODUCER'].includes(a.role) || !money(a.amountCents) || !money(a.lockedCents)
                || a.lockedCents > a.amountCents || (a.role !== 'COPRODUCER' && !text(a.externalBeneficiaryId))) throw new BadRequestException('Invalid receipt allocation');
            ids.add(a.allocationId);
        }
        return this.prisma.$transaction(async tx => {
            const rows = await tx.$queryRaw<any[]>`SELECT * FROM ebook_settlement_manifests WHERE "manifestId" = ${receipt.manifestId}::uuid FOR UPDATE`;
            const row = rows[0];
            if (!row) throw new BadRequestException('Unknown settlement manifest');
            if (manifestHash(row.manifest) !== receipt.manifestHash || row.manifest.orderId !== receipt.orderId || row.manifest.orderNumber !== receipt.orderNumber || row.manifest.grossCents !== receipt.grossCents
                || (row.settlementId && row.settlementId !== receipt.settlementId) || (row.manifestHash && row.manifestHash !== receipt.manifestHash)) throw new ConflictException('Settlement identity mismatch');
            for (const a of receipt.allocations) {
                const item = row.manifest.items.find((i: any) => i.itemId === a.itemId);
                if (!item || (a.role === 'OWNER' && a.externalBeneficiaryId !== item.owner.externalUserId)
                    || (a.role === 'AFFILIATE' && a.externalBeneficiaryId !== item.affiliate?.externalUserId)) throw new ConflictException('Allocation identity mismatch');
            }
            const prior = await tx.$queryRaw<any[]>`SELECT * FROM ebook_settlement_receipts WHERE "receiptId" = ${receipt.receiptId} OR ("manifestId" = ${receipt.manifestId}::uuid AND revision = ${receipt.revision})`;
            if (prior.length) {
                if (prior.length !== 1 || canonical(prior[0].receipt) !== canonical(receipt)) throw new ConflictException('Receipt replay conflict');
                return { acknowledged: true, receiptId: receipt.receiptId };
            }
            if (receipt.revision > row.revision) {
                for (const item of row.manifest.items) {
                    if (!item.affiliate) continue;
                    const allocations = receipt.allocations.filter((a: any) => a.itemId === item.itemId && a.role === 'AFFILIATE');
                    if (allocations.length > 1) throw new ConflictException('Duplicate affiliate role allocation');
                    if (!allocations.length) continue;
                    const amount = allocations[0].amountCents / 100;
                    const status = receipt.status === 'REVERSED' ? 'REVERSED' : receipt.status === 'SETTLED' ? 'CREDITED' : 'PENDING';
                    const projected = await tx.$executeRaw`INSERT INTO affiliate_commissions ("affiliateId", "bookId", "orderId", "orderNumber", "grossAmount", "commissionRate", "commissionAmount", status, "createdAt", "reversedAt", "settlementManifestId") VALUES (${item.affiliate.externalUserId}, ${item.productId}, ${receipt.orderId}, ${receipt.orderNumber}, ${item.grossCents / 100}, ${item.affiliate.commissionRateBps / 100}, ${amount}, ${status}::"AffiliateCommissionStatus", NOW(), CASE WHEN ${status} = 'REVERSED' THEN NOW() ELSE NULL END, ${receipt.manifestId}::uuid) ON CONFLICT ("orderId", "bookId") DO UPDATE SET "commissionAmount" = EXCLUDED."commissionAmount", status = EXCLUDED.status, "reversedAt" = EXCLUDED."reversedAt" WHERE affiliate_commissions."settlementManifestId" = EXCLUDED."settlementManifestId"`;
                    if (projected !== 1) throw new ConflictException('Legacy affiliate projection conflict');
                }
            }
            await tx.$executeRaw`INSERT INTO ebook_settlement_receipts ("receiptId", "manifestId", revision, receipt) VALUES (${receipt.receiptId}, ${receipt.manifestId}::uuid, ${receipt.revision}, ${JSON.stringify(receipt)}::jsonb)`;
            await tx.$executeRaw`UPDATE ebook_settlement_manifests SET "settlementId" = ${receipt.settlementId}, "manifestHash" = ${receipt.manifestHash}, revision = CASE WHEN revision < ${receipt.revision} THEN ${receipt.revision} ELSE revision END, projection = CASE WHEN revision < ${receipt.revision} THEN ${JSON.stringify(receipt)}::jsonb ELSE projection END WHERE "manifestId" = ${receipt.manifestId}::uuid`;
            return { acknowledged: true, receiptId: receipt.receiptId };
        });
    }
}
