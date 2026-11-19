import { randomUUID } from 'crypto';
import type { PrismaService } from 'prisma/prisma.service';
import { isSimintpayPlatformConfigured, merchantEntry, SimintpayPlatformError } from '../common/simintpay-platform';

type Delivery = { id: number; snapshot: { referenceId: string; orderNumber?: string; cpf: string | null; cnpj: string | null; amount: number; description: string } };

/** Entrega canônica de comissão de afiliado (POST /platforms/EBOOK/merchants/:doc/finance/entries, kind=commission). */
export async function retryCommissionDeliveries(prisma: PrismaService, limit = 20): Promise<void> {
    if (!isSimintpayPlatformConfigured()) return;
    for (let i = 0; i < Math.min(Math.max(limit, 0), 100); i++) {
        const lease = randomUUID();
        const rows = await prisma.$queryRaw<Delivery[]>`
            UPDATE affiliate_commission_deliveries SET lease_token = ${lease},
                lease_until = NOW() + INTERVAL '1 minute', attempts = attempts + 1
            WHERE id = (SELECT delivery.id FROM affiliate_commission_deliveries delivery
                WHERE protocol = 'LEGACY_RECORD_ONLY' AND state IN ('PENDING', 'RETRY')
                AND next_attempt_at <= NOW() AND (lease_until IS NULL OR lease_until < NOW())
                AND EXISTS (SELECT 1 FROM affiliate_commissions c WHERE c.id = delivery.commission_id AND c.status = 'CREDITED'
                    AND NOT EXISTS (SELECT 1 FROM ebook_settlement_manifests m WHERE m."orderId" = c."orderId"))
                ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1)
            RETURNING id, snapshot`;
        const row = rows[0];
        if (!row) return;
        try {
            const { referenceId, orderNumber, cpf, cnpj, amount, description } = row.snapshot;
            if (!cpf && !cnpj) throw new Error('Frozen recipient has no document; manual reconciliation required');
            // Canônico: o afiliado precisa estar provisionado como comerciante (senão 404 → RETRY/reconciliação manual).
            // Credita a carteira do afiliado (BalanceLog EBOOK_COMMISSION). orderNumber é obrigatório: se o pedido
            // tiver liquidação o SimIntPay responde {skipped:'SETTLEMENT_CREDITS_AFFILIATE'} (a alocação já credita) — sucesso.
            if (!orderNumber) throw new Error('Frozen commission has no orderNumber; manual reconciliation required');
            await merchantEntry(String(cpf || cnpj), {
                referenceId, orderNumber, kind: 'commission', amountCents: Math.round(amount * 100),
                paymentMethod: 'PIX', description: description || 'Comissão de afiliado',
            });
            await prisma.$executeRaw`UPDATE affiliate_commission_deliveries SET state = 'ACKNOWLEDGED',
                financial_state = 'LEGACY_RECORDED', acknowledged_at = NOW(), lease_token = NULL,
                lease_until = NULL, last_error = NULL WHERE id = ${row.id} AND lease_token = ${lease}`;
        } catch (error) {
            // Do not retain response bodies, tokens or recipient documents in diagnostics.
            const message = error instanceof SimintpayPlatformError ? `SimIntPay HTTP ${error.status}`
                : error instanceof Error && /^(Legacy HTTP|Frozen )/.test(error.message) ? error.message : 'Legacy delivery failed';
            await prisma.$executeRaw`UPDATE affiliate_commission_deliveries SET state = 'RETRY',
                next_attempt_at = NOW() + INTERVAL '5 minutes', last_error = ${message},
                lease_token = NULL, lease_until = NULL WHERE id = ${row.id} AND lease_token = ${lease}`;
        }
    }
}
