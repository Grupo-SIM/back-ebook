import { test, expect } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createAffiliateAttribution, readAffiliateAttribution } from '../src/affiliate/affiliate-attribution';

test('checkout attribution: multiple affiliates, unconfirmed missing rate and immutable nullable database evidence', async () => {
    const container = `ebook-attribution-${randomUUID()}`;
    const sql = query => execFileSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At', '-c', query], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    const book = { id: 2, createdById: 'owner', isAffiliate: true, commissionRate: null };
    const first = createAffiliateAttribution(book, { id: 1, bookId: 2, affiliateId: 'first', code: 'FIRST' }, 'buyer');
    const second = createAffiliateAttribution(book, { id: 2, bookId: 2, affiliateId: 'second', code: 'SECOND' }, 'buyer');
    expect(first).toMatchObject({ bookId: 2, ownerId: 'owner', affiliateId: 'first', buyerId: 'buyer', commissionRate: null, rateSource: 'UNCONFIRMED', linkId: 1, code: 'FIRST' });
    expect(second.affiliateId).toBe('second');
    expect(second.commissionRate).toBe(first.commissionRate);
    expect(() => readAffiliateAttribution(null)).toThrow('Legacy/unconfirmed');
    expect(createAffiliateAttribution({ ...book, commissionRate: 0 }, null, 'buyer').affiliateId).toBeNull();
    const literal = value => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
    try {
        execFileSync('docker', ['run', '--pull=never', '--rm', '-d', '--name', container, '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:16-alpine']);
        for (let n = 0; ; n++) {
            try { sql('SELECT 1'); break; } catch (error) { if (n > 60) throw error; await Bun.sleep(250); }
        }
        sql('CREATE TABLE order_items (id int PRIMARY KEY)');
        sql(readFileSync(new URL('../prisma/migrations/20261102000000_affiliate_attribution/migration.sql', import.meta.url), 'utf8'));
        sql(`INSERT INTO order_items VALUES (1,${literal(first)}),(2,${literal(second)}),(3,NULL)`);
        sql('UPDATE order_items SET id=id');
        for (const statement of [
            `UPDATE order_items SET "affiliateAttribution"=${literal(second)} WHERE id=1`,
            'UPDATE order_items SET "affiliateAttribution"=NULL WHERE id=1',
            `UPDATE order_items SET "affiliateAttribution"=${literal(first)} WHERE id=3`,
        ]) expect(() => sql(statement)).toThrow();
        expect(sql('SELECT "affiliateAttribution" IS NULL FROM order_items WHERE id=3')).toBe('t');
        expect(JSON.parse(sql('SELECT "affiliateAttribution" FROM order_items WHERE id=1'))).toEqual(first);
    } finally {
        execFileSync('docker', ['rm', '-f', container]);
    }
}, 60000);
