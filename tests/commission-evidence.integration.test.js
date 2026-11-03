import { test, expect } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createAffiliateAttribution } from '../src/affiliate/affiliate-attribution';
import { AffiliateService } from '../src/affiliate/affiliate.service';

// Exercise the actual service transaction against disposable persisted associations.
test('commission evidence: persisted cents, rejection, replay and delivery rollback', async () => {
    const container = `ebook-evidence-${randomUUID()}`;
    const sql = query => execFileSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At', '-c', query], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    const item = { bookId: 2, totalPrice: 0.3, affiliateProductLink: { affiliateId: 'affiliate', code: 'link' },
        book: { isAffiliate: true, createdById: 'seller', commissionRate: 10 } };
    item.affiliateAttribution = createAffiliateAttribution({ id: 2, createdById: 'seller', isAffiliate: true, commissionRate: 10 }, { id: 4, bookId: 2, affiliateId: 'affiliate', code: 'link' }, 'buyer');
    const order = { userId: 'buyer', id: 1, orderNumber: 'order-1', orderItems: [item] };
    const row = { id: 3, orderId: 1, bookId: 2, quantity: 3, unitPrice: 0.1, totalPrice: 0.3,
        affiliateAttribution: item.affiliateAttribution, affiliateProductLinkId: 4, order: { orderNumber: 'order-1', userId: 'buyer' }, book: { createdById: 'seller' }, affiliateProductLink: item.affiliateProductLink };
    let failDelivery = false;
    let snapshot;
    const literal = value => `'${JSON.stringify(value).replaceAll("'", "''")}'`;
    const prisma = {
        user: { findUnique: async () => ({ id: 'affiliate', cpf: '123' }) },
        $transaction: async callback => {
            const statements = [];
            const tx = {
                orderItem: { findMany: async () => JSON.parse(sql('SELECT coalesce(json_agg(evidence),\'[]\') FROM items')) },
                affiliateCommission: { create: async ({ data }) => {
                    statements.push(`INSERT INTO commissions VALUES (1,${data.orderId},${data.bookId})`);
                    return { id: 1 };
                } },
                $executeRaw: async (_strings, id, encoded) => {
                    snapshot = JSON.parse(encoded);
                    statements.push(`INSERT INTO deliveries VALUES (${id},${literal(snapshot)}::jsonb)`);
                    if (failDelivery) statements.push('SELECT 1/0');
                },
            };
            await callback(tx);
            try { sql(`BEGIN; ${statements.join(';')}; COMMIT`); }
            catch (error) {
                if (String(error.stderr).includes('duplicate key')) error.code = 'P2002';
                throw error;
            }
        },
    };
    const service = new AffiliateService(prisma);
    const setRows = rows => sql(`DELETE FROM items; ${rows.map(r => `INSERT INTO items VALUES (${literal(r)}::jsonb)`).join(';')}`);
    try {
        execFileSync('docker', ['run', '--pull=never', '--rm', '-d', '--name', container, '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:16-alpine']);
        for (let n = 0; ; n++) {
            try { sql('SELECT 1'); break; } catch (error) { if (n > 60) throw error; await Bun.sleep(250); }
        }
        sql('CREATE TABLE items (evidence jsonb); CREATE TABLE commissions (id int PRIMARY KEY, order_id int, book_id int, UNIQUE(order_id,book_id)); CREATE TABLE deliveries (commission_id int REFERENCES commissions(id), snapshot jsonb)');
        for (const rows of [[], [row, row], [{ ...row, orderId: 9 }], [{ ...row, bookId: 9 }],
            [{ ...row, order: { orderNumber: 'wrong' } }],
            [{ ...row, affiliateAttribution: null }],
            ...['bookId', 'ownerId', 'buyerId', 'affiliateId', 'code', 'linkId', 'commissionRate'].map(key => [{ ...row, affiliateAttribution: { ...row.affiliateAttribution, [key]: typeof row.affiliateAttribution[key] === 'number' ? 999 : 'mismatch' } }]), [{ ...row, quantity: 2 }],
            [{ ...row, unitPrice: 0.101 }], [{ ...row, totalPrice: 0.301 }],
            [{ ...row, unitPrice: 0.2, totalPrice: 0.6 }]]) {
            setRows(rows);
            await service.creditCommissionForOrder(order);
            expect(sql('SELECT count(*) FROM commissions')).toBe('0');
            expect(sql('SELECT count(*) FROM deliveries')).toBe('0');
        }
        setRows([{ ...row, book: { createdById: 'changed-owner' }, affiliateProductLink: null }]);
        item.book = { isAffiliate: false, createdById: 'changed-owner', commissionRate: 99 };
        item.affiliateProductLink = null;
        failDelivery = true;
        await service.creditCommissionForOrder(order);
        expect(sql('SELECT count(*) FROM commissions')).toBe('0');
        failDelivery = false;
        await service.creditCommissionForOrder(order);
        expect(snapshot.evidenceVersion).toBe(2);
        expect(snapshot.grossCents).toBe(30);
        expect(snapshot.commissionCents).toBe(3);
        expect(snapshot.orderItems[0].unitPriceCents).toBe(10);
        expect(snapshot.amount).toBe(0.03);
        expect(snapshot.attribution.buyerId).toBe('buyer');
        expect(snapshot.fundingRule).toBe('SELLER_FUNDED_GROSS_COMMISSION');
        const persisted = sql('SELECT snapshot FROM deliveries');
        await service.creditCommissionForOrder(order);
        expect(sql('SELECT count(*) FROM commissions')).toBe('1');
        expect(sql('SELECT count(*) FROM deliveries')).toBe('1');
        expect(sql('SELECT snapshot FROM deliveries')).toBe(persisted);
    } finally {
        execFileSync('docker', ['rm', '-f', container]);
    }
}, 180000);
