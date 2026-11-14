import { randomUUID } from 'crypto';
import type { PrismaService } from 'prisma/prisma.service';
import { tryCanonicalPendingEntry, type PendingEntryParams } from './canonical-pending-entry';

/** Tentativas antes de desistir (backoff de 5 min x tentativa, no máximo 1 h): ~1 dia; depois, reconciliação manual. */
export const PENDING_ENTRY_MAX_ATTEMPTS = 24;

/** Grava (idempotente por pedido) a entrada pendente que falhou para reenvio durável. Nunca lança. */
export async function enqueuePendingEntry(prisma: Pick<PrismaService, '$executeRaw'>, params: PendingEntryParams): Promise<void> {
    try {
        const snapshot = JSON.stringify({
            orderNumber: params.orderNumber, amount: params.amount, ownerDocument: params.ownerDocument,
            ownerName: params.ownerName ?? null, paymentMethod: params.paymentMethod ?? null, buyer: params.buyer ?? null,
        });
        await prisma.$executeRaw`INSERT INTO ebook_pending_entry_deliveries (order_number, snapshot)
            VALUES (${params.orderNumber}, ${snapshot}::jsonb) ON CONFLICT (order_number) DO NOTHING`;
    } catch {
        console.error(`[simintpay] não foi possível enfileirar a entrada pendente do pedido ${params.orderNumber}`);
    }
}

type Row = { id: number; order_number: string; attempts: number; snapshot: PendingEntryParams; status: string | null };

/**
 * Reenvia as entradas pendentes que falharam (padrão de `retryCommissionDeliveries`: lease por linha, backoff, ack).
 * Só reenvia enquanto o pedido ainda está `pending`: pedido pago/cancelado vira SKIPPED (a venda paga é registrada pelo
 * webhook DOM, e uma entrada pendente tardia ficaria órfã). O SimIntPay é idempotente por `EBOOK_PENDING_<orderNumber>`.
 */
export async function retryPendingEntryDeliveries(prisma: PrismaService, limit = 20): Promise<void> {
    for (let i = 0; i < Math.min(Math.max(limit, 0), 100); i++) {
        const lease = randomUUID();
        const rows = await prisma.$queryRaw<Row[]>`
            UPDATE ebook_pending_entry_deliveries SET lease_token = ${lease},
                lease_until = NOW() + INTERVAL '1 minute', attempts = attempts + 1
            WHERE id = (SELECT delivery.id FROM ebook_pending_entry_deliveries delivery
                WHERE state IN ('PENDING', 'RETRY') AND next_attempt_at <= NOW()
                AND (lease_until IS NULL OR lease_until < NOW())
                ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1)
            RETURNING id, order_number, attempts, snapshot,
                (SELECT o.status FROM orders o WHERE o."orderNumber" = ebook_pending_entry_deliveries.order_number) AS status`;
        const row = rows[0];
        if (!row) return;
        if (row.status !== 'pending') {
            await prisma.$executeRaw`UPDATE ebook_pending_entry_deliveries SET state = 'SKIPPED', last_error = ${`order ${row.status ?? 'missing'}`},
                lease_token = NULL, lease_until = NULL WHERE id = ${row.id} AND lease_token = ${lease}`;
            continue;
        }
        const ok = await tryCanonicalPendingEntry(row.snapshot);
        if (ok) {
            await prisma.$executeRaw`UPDATE ebook_pending_entry_deliveries SET state = 'ACKNOWLEDGED', acknowledged_at = NOW(),
                last_error = NULL, lease_token = NULL, lease_until = NULL WHERE id = ${row.id} AND lease_token = ${lease}`;
        } else if (row.attempts >= PENDING_ENTRY_MAX_ATTEMPTS) {
            await prisma.$executeRaw`UPDATE ebook_pending_entry_deliveries SET state = 'SKIPPED', last_error = 'max attempts; manual reconciliation required',
                lease_token = NULL, lease_until = NULL WHERE id = ${row.id} AND lease_token = ${lease}`;
        } else {
            const minutes = Math.min(5 * row.attempts, 60);
            await prisma.$executeRaw`UPDATE ebook_pending_entry_deliveries SET state = 'RETRY',
                next_attempt_at = NOW() + (${minutes} * INTERVAL '1 minute'), last_error = 'SimIntPay entry failed',
                lease_token = NULL, lease_until = NULL WHERE id = ${row.id} AND lease_token = ${lease}`;
        }
    }
}
