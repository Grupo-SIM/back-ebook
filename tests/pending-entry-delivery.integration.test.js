import { test, expect } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { enqueuePendingEntry, retryPendingEntryDeliveries } from '../src/checkout/pending-entry-delivery';

test('disposable PostgreSQL: failed pending entry is queued, retried with backoff, sent once and skipped for paid orders', async () => {
    const container = `ebook-pending-entry-${randomUUID()}`;
    const sql = (query) => execFileSync('docker', ['exec', '-i', container, 'psql', '-h', '127.0.0.1', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At', '-c', query], { encoding: 'utf8' }).trim();
    const saved = Object.fromEntries(['EBOOK_CANONICAL_FINANCE', 'SIMINTPAY_URL', 'SIMINTPAY_PLATFORM_TOKEN'].map(key => [key, process.env[key]]));
    let status = 503;
    const requests = [];
    const server = Bun.serve({ port: 0, fetch: async request => {
        requests.push({ path: new URL(request.url).pathname, body: await request.json() });
        return new Response('{}', { status });
    } });
    try {
        execFileSync('docker', ['run', '--rm', '-d', '--name', container, '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:16-alpine']);
        for (let n = 0; ; n++) {
            try { sql('SELECT 1'); break; } catch (error) { if (n > 60) throw error; await Bun.sleep(250); }
        }
        sql(`CREATE TABLE orders (id serial PRIMARY KEY, "orderNumber" text UNIQUE, status text);
            INSERT INTO orders ("orderNumber", status) VALUES ('ORD-1','pending'), ('ORD-2','pending');`);
        sql(readFileSync(new URL('../prisma/migrations/20261114120000_pending_entry_delivery/migration.sql', import.meta.url), 'utf8'));
        const interpolate = (parts, values) => parts.reduce((text, part, i) => text + part + (i < values.length ? `'${String(values[i]).replaceAll("'", "''")}'` : ''), '');
        const prisma = {
            $queryRaw: async (parts, ...values) => {
                const result = sql(`WITH result AS (${interpolate(parts, values)}) SELECT row_to_json(result) FROM result`);
                return result ? result.split('\n').map(line => JSON.parse(line)) : [];
            },
            $executeRaw: async (parts, ...values) => sql(interpolate(parts, values)),
        };
        process.env.EBOOK_CANONICAL_FINANCE = 'true';
        process.env.SIMINTPAY_URL = `http://localhost:${server.port}`;
        process.env.SIMINTPAY_PLATFORM_TOKEN = 'local-test';
        const params = (orderNumber) => ({ orderNumber, amount: 90, ownerDocument: '52998224725', ownerName: 'Dono', paymentMethod: 'credit_card', buyer: { name: 'Comprador', cpf: '123.456.789-09' } });

        await enqueuePendingEntry(prisma, params('ORD-1'));
        await enqueuePendingEntry(prisma, params('ORD-1')); // idempotent
        await enqueuePendingEntry(prisma, params('ORD-2'));
        expect(sql('SELECT count(*) FROM ebook_pending_entry_deliveries')).toBe('2');

        // SimIntPay down: ORD-1 goes to RETRY with backoff, nothing acknowledged.
        await retryPendingEntryDeliveries(prisma, 1);
        expect(sql(`SELECT state || attempts FROM ebook_pending_entry_deliveries WHERE order_number='ORD-1'`)).toBe('RETRY1');
        // Not due yet: the next pass takes the other row (ORD-2, also 503), never ORD-1 again.
        await retryPendingEntryDeliveries(prisma, 1);
        expect(sql(`SELECT attempts FROM ebook_pending_entry_deliveries WHERE order_number='ORD-1'`)).toBe('1');

        // ORD-2 got paid meanwhile: skipped, no entry is sent for it.
        sql(`UPDATE orders SET status='paid' WHERE "orderNumber"='ORD-2'`);
        sql(`UPDATE ebook_pending_entry_deliveries SET next_attempt_at = NOW() WHERE order_number='ORD-2'`);
        await retryPendingEntryDeliveries(prisma, 5);
        expect(sql(`SELECT state FROM ebook_pending_entry_deliveries WHERE order_number='ORD-2'`)).toBe('SKIPPED');

        // SimIntPay back: ORD-1 is acknowledged once, with the idempotent reference and PIX 1x at the owner amount.
        status = 200;
        sql(`UPDATE ebook_pending_entry_deliveries SET next_attempt_at = NOW() WHERE order_number='ORD-1'`);
        await retryPendingEntryDeliveries(prisma, 5);
        await retryPendingEntryDeliveries(prisma, 5);
        expect(sql(`SELECT state FROM ebook_pending_entry_deliveries WHERE order_number='ORD-1'`)).toBe('ACKNOWLEDGED');
        const sent = requests.filter(request => request.body.referenceId === 'ORD-1');
        expect(sent).toHaveLength(2); // one failed attempt + one accepted
        // ORD-2 was attempted once while pending (503) and never again after being paid.
        expect(requests.filter(request => request.body.referenceId === 'ORD-2')).toHaveLength(1);
        expect(requests.at(-1).path).toBe('/platforms/EBOOK/merchants/52998224725/finance/entries');
        expect(requests.at(-1).body).toMatchObject({ kind: 'pending', amountCents: 9000, installments: 1 });
        expect(requests.at(-1).body.netAmountCents).toBeUndefined();
    } finally {
        server.stop(true);
        for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
        execFileSync('docker', ['rm', '-f', container]);
    }
}, 90000);
