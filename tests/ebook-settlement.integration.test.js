import { test, expect } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

// Disposable PostgreSQL only. No service URLs or application credentials used.
test('settlement persistence enforces immutable identities, receipt deduplication and atomic projection', () => {
    const container = `ebook-settlement-${randomUUID()}`;
    const sql = query => execFileSync('docker', ['exec', '-i', container, 'psql', '-h', '127.0.0.1', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At', '-c', query], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    try {
        execFileSync('docker', ['run', '--rm', '-d', '--name', container, '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:16-alpine']);
        execFileSync('docker', ['exec', container, 'sh', '-c', 'until pg_isready -h 127.0.0.1 -U postgres; do sleep 0.2; done']);
        sql('CREATE TABLE orders (id INTEGER PRIMARY KEY); CREATE TABLE affiliate_commissions (id INTEGER PRIMARY KEY); INSERT INTO orders VALUES (1)');
        sql(readFileSync(new URL('../prisma/migrations/20261102120000_ebook_settlement/migration.sql', import.meta.url), 'utf8'));
        const id = randomUUID();
        sql(`INSERT INTO ebook_settlement_manifests ("manifestId", "orderId", manifest) VALUES ('${id}',1,'{}')`);
        expect(() => sql(`INSERT INTO ebook_settlement_manifests ("manifestId", "orderId", manifest) VALUES ('${randomUUID()}',1,'{}')`)).toThrow();
        sql(`INSERT INTO ebook_settlement_receipts ("receiptId", "manifestId", revision,receipt) VALUES ('r1','${id}',1,'{}')`);
        expect(() => sql(`INSERT INTO ebook_settlement_receipts ("receiptId", "manifestId", revision,receipt) VALUES ('r2','${id}',1,'{}')`)).toThrow();
        expect(() => sql(`BEGIN; UPDATE ebook_settlement_manifests SET revision=2 WHERE "manifestId"='${id}'; INSERT INTO ebook_settlement_receipts ("receiptId", "manifestId", revision,receipt) VALUES ('r1','${id}',2,'{}'); COMMIT;`)).toThrow();
        expect(sql(`SELECT revision FROM ebook_settlement_manifests WHERE "manifestId"='${id}'`)).toBe('-1');
        expect(() => sql(`UPDATE ebook_settlement_manifests SET manifest='{"changed":true}' WHERE "manifestId"='${id}'`)).toThrow();
        expect(() => sql(`DELETE FROM ebook_settlement_receipts WHERE "receiptId"='r1'`)).toThrow();
    } finally { execFileSync('docker', ['rm', '-f', container]); }
}, 60000);
