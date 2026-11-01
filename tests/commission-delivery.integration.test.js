import { test, expect } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { retryCommissionDeliveries } from '../src/affiliate/commission-delivery';

test('disposable PostgreSQL: quarantine, immutable snapshots, retry leases and legacy-only acknowledgement', async () => {
    const container = `ebook-commission-${randomUUID()}`;
    const sql = (query) => execFileSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At', '-c', query], { encoding: 'utf8' }).trim();
    const previousBase = process.env.API_MACHINE_URL;
    const previousToken = process.env.API_MACHINE_INTERNAL_TOKEN;
    let status = 503;
    const paths = [];
    const server = Bun.serve({ port: 0, fetch: request => {
        paths.push(new URL(request.url).pathname);
        return new Response('{}', { status });
    } });
    try {
        execFileSync('docker', ['run', '--rm', '-d', '--name', container, '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:16-alpine']);
        for (let n = 0; ; n++) {
            try { sql('SELECT 1'); break; } catch (error) { if (n > 60) throw error; await Bun.sleep(250); }
        }
        sql(`CREATE TABLE affiliate_commissions (id integer PRIMARY KEY, "orderId" integer, "bookId" integer, "affiliateId" text, "commissionAmount" float, status text);
            INSERT INTO affiliate_commissions VALUES (1,1,1,'affiliate',10,'CREDITED');`);
        sql(readFileSync(new URL('../prisma/migrations/20261101120000_commission_delivery_outbox/migration.sql', import.meta.url), 'utf8'));
        expect(sql('SELECT state || funding_state FROM affiliate_commission_deliveries')).toBe('QUARANTINEDUNCONFIRMED');
        sql(`INSERT INTO affiliate_commissions VALUES (2,2,2,'affiliate',10,'CREDITED');
            INSERT INTO affiliate_commission_deliveries (commission_id,state,snapshot) VALUES (2,'PENDING','{"referenceId":"2-2","cpf":"123","cnpj":null,"amount":10,"description":"commission"}');`);
        expect(() => sql(`UPDATE affiliate_commission_deliveries SET snapshot = '{}' WHERE commission_id = 2`)).toThrow();
        expect(() => sql(`INSERT INTO affiliate_commission_deliveries (commission_id,snapshot) VALUES (2,'{}')`)).toThrow();
        // Real SQL executes through psql without installing a database driver for the test.
        const interpolate = (parts, values) => parts.reduce((text, part, i) => text + part + (i < values.length ? `'${String(values[i]).replaceAll("'", "''")}'` : ''), '');
        const prisma = {
            $queryRaw: async (parts, ...values) => {
                const result = sql(`WITH result AS (${interpolate(parts, values)}) SELECT row_to_json(result) FROM result`);
                return result ? result.split('\n').map(line => JSON.parse(line)) : [];
            },
            $executeRaw: async (parts, ...values) => sql(interpolate(parts, values)),
        };
        process.env.API_MACHINE_URL = `http://localhost:${server.port}`;
        process.env.API_MACHINE_INTERNAL_TOKEN = 'local-test';
        await retryCommissionDeliveries(prisma, 1);
        expect(sql('SELECT state FROM affiliate_commission_deliveries WHERE commission_id=2')).toBe('RETRY');
        sql(`UPDATE affiliate_commission_deliveries SET next_attempt_at=NOW(), lease_until=NOW()+INTERVAL '1 minute' WHERE commission_id=2`);
        status = 200;
        await retryCommissionDeliveries(prisma, 1);
        expect(sql('SELECT attempts FROM affiliate_commission_deliveries WHERE commission_id=2')).toBe('1');
        sql(`UPDATE affiliate_commission_deliveries SET lease_until=NOW()-INTERVAL '1 minute' WHERE commission_id=2`);
        await retryCommissionDeliveries(prisma, 1);
        expect(sql('SELECT state || financial_state || funding_state FROM affiliate_commission_deliveries WHERE commission_id=2')).toBe('ACKNOWLEDGEDLEGACY_RECORDEDUNCONFIRMED');
        expect(sql('SELECT attempts FROM affiliate_commission_deliveries WHERE commission_id=1')).toBe('0');
        expect(paths).toEqual(['/internal/ebook/finance/credit-commission', '/internal/ebook/finance/credit-commission']);
    } finally {
        server.stop(true);
        if (previousBase === undefined) delete process.env.API_MACHINE_URL; else process.env.API_MACHINE_URL = previousBase;
        if (previousToken === undefined) delete process.env.API_MACHINE_INTERNAL_TOKEN; else process.env.API_MACHINE_INTERNAL_TOKEN = previousToken;
        execFileSync('docker', ['rm', '-f', container]);
    }
}, 60000);
