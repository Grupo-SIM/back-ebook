import { test, expect } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { allocateFixedFee, createFixedFeeSnapshot, moneyToCents } from '../src/checkout/fixed-fee-snapshot';

test('disposable PostgreSQL: immutable additive snapshots, exact allocation and rollback', async () => {
    const container = `ebook-fee-${randomUUID()}`;
    const sql = query => execFileSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At', '-c', query], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    try {
        execFileSync('docker', ['run', '--pull=never', '--rm', '-d', '--name', container, '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:16-alpine']);
        for (let n = 0; ; n++) {
            try { sql('SELECT 1'); break; } catch (error) { if (n > 60) throw error; await Bun.sleep(250); }
        }
        sql('CREATE TABLE orders (id int PRIMARY KEY, status text); CREATE TABLE order_items (id int PRIMARY KEY, "orderId" int REFERENCES orders(id)); INSERT INTO orders VALUES (1, \'pending\')');
        sql(readFileSync(new URL('../prisma/migrations/20261101000000_fixed_fee_snapshot/migration.sql', import.meta.url), 'utf8'));
        expect(sql('SELECT "fixedFeeSnapshot" IS NULL FROM orders WHERE id=1')).toBe('t');
        const items = [{ itemId: 'b', sellerId: 'seller-b', grossCents: 100 }, { itemId: 'a', sellerId: 'seller-a', grossCents: 100 }, { itemId: 'c', sellerId: 'seller-a', grossCents: 100 }];
        const unequal = [{ itemId: 'z', sellerId: 'seller-z', grossCents: 199 }, { itemId: 'a', sellerId: 'seller-a', grossCents: 101 }];
        expect(allocateFixedFee(300, 4, unequal)).toEqual([{ ...unequal[0], fixedFeeCents: 3 }, { ...unequal[1], fixedFeeCents: 1 }]);
        const allocated = allocateFixedFee(300, 2, items);
        expect(allocated.map(i => i.fixedFeeCents)).toEqual([1, 1, 0]);
        expect(allocateFixedFee(300, 2, [...items].reverse()).sort((a,b) => a.itemId.localeCompare(b.itemId))).toEqual([...allocated].sort((a,b) => a.itemId.localeCompare(b.itemId)));
        expect(() => allocateFixedFee(0, 0, [])).toThrow();
        expect(() => allocateFixedFee(301, 2, items)).toThrow();
        expect(allocateFixedFee(300, 301, items).reduce((sum,i) => sum+i.fixedFeeCents,0)).toBe(301);
        expect(() => allocateFixedFee(300, 2, [items[0], items[0], items[0]])).toThrow();
        expect(() => moneyToCents(1.001)).toThrow();
        expect(() => moneyToCents(NaN)).toThrow();
        // Extracted cart/buy-now boundary: charged originalPrice differs from persisted price.
        const cartSnapshot = createFixedFeeSnapshot(60, 4, [{ sellerId: 'one', gross: 10 }, { sellerId: 'two', gross: 20 }]);
        expect(cartSnapshot.allocationBasis).toBe('ITEM_GROSS');
        expect(cartSnapshot.chargedTotalCents).toBe(6000);
        expect(cartSnapshot.grossCents).toBe(3000);
        expect(cartSnapshot.items.map(i => i.fixedFeeCents)).toEqual([133, 267]);
        const buyNowSnapshot = createFixedFeeSnapshot(40, 4, [{ sellerId: 'one', gross: 20 }]);
        expect(buyNowSnapshot.chargedTotalCents).toBe(4000);
        expect(buyNowSnapshot.grossCents).toBe(2000);
        expect(buyNowSnapshot.items[0].fixedFeeCents).toBe(400);
        const snapshot = createFixedFeeSnapshot(3, 4, items.map(i => ({ sellerId: i.sellerId, gross: 1 })));
        expect(snapshot.effectiveFixedFeeCents).toBe(400);
        expect(snapshot.items.reduce((sum,i) => sum+i.fixedFeeCents,0)).toBe(400);
        const encoded = JSON.stringify(snapshot).replaceAll("'", "''");
        sql(`BEGIN; INSERT INTO orders VALUES (2, 'pending', '${encoded}'::jsonb); INSERT INTO order_items VALUES (2, 2, '${snapshot.items[0].itemId}'); COMMIT;`);
        sql("UPDATE orders SET status='paid' WHERE id=2");
        expect(() => sql("UPDATE orders SET \"fixedFeeSnapshot\"='{}' WHERE id=2")).toThrow();
        expect(() => sql("UPDATE orders SET \"fixedFeeSnapshot\"='{}' WHERE id=1")).toThrow();
        expect(() => sql("UPDATE order_items SET \"fixedFeeItemId\"='changed' WHERE id=2")).toThrow();
        expect(() => sql(`BEGIN; INSERT INTO orders VALUES (3,'pending','${encoded}'); INSERT INTO order_items VALUES (3,3,'${snapshot.items[0].itemId}'); COMMIT`)).toThrow();
        expect(sql('SELECT count(*) FROM orders WHERE id=3')).toBe('0');
    } finally {
        execFileSync('docker', ['rm', '-f', container]);
    }
}, 60000);
