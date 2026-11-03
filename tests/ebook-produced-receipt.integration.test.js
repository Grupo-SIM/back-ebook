import { test, expect } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../prisma/generated/prisma';
import { SettlementReceiptsController } from '../src/checkout/settlement-receipts.controller';

// Opt-in cross-service contract test. Input must be emitted by the REAL backend
// disposable settlement scenario, not a separately hand-authored receipt fixture.
const fixturePath = process.env.EBOOK_SETTLEMENT_RECEIPT_FILE;
(fixturePath ? test : test.skip)('consume actual backend receipts durably with visible affiliate projection', async () => {
    const { manifest, receipts } = JSON.parse(readFileSync(fixturePath, 'utf8'));
    expect(receipts.length).toBeGreaterThanOrEqual(2);
    const container = `ebook-produced-receipt-${randomUUID()}`;
    const sql = query => execFileSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At', '-c', query], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    const oldToken = process.env.API_MACHINE_INTERNAL_TOKEN;
    let pool;
    let prisma;
    try {
        execFileSync('docker', ['run', '--rm', '-d', '--name', container, '-p', '127.0.0.1::5432', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:16-alpine']);
        execFileSync('docker', ['exec', container, 'sh', '-c', 'until pg_isready -U postgres; do sleep 0.2; done']);
        const port = execFileSync('docker', ['port', container, '5432/tcp'], { encoding: 'utf8' }).trim().split(':').at(-1);
        sql(`CREATE TABLE orders (id INTEGER PRIMARY KEY); CREATE TYPE "AffiliateCommissionStatus" AS ENUM ('PENDING','CREDITED','REVERSED'); CREATE TABLE affiliate_commissions (id SERIAL PRIMARY KEY,"affiliateId" TEXT,"bookId" INTEGER,"orderId" INTEGER,"orderNumber" TEXT,"grossAmount" DOUBLE PRECISION,"commissionRate" DOUBLE PRECISION,"commissionAmount" DOUBLE PRECISION,status "AffiliateCommissionStatus","createdAt" TIMESTAMPTZ,"reversedAt" TIMESTAMPTZ,UNIQUE("orderId","bookId")); CREATE TABLE affiliate_commission_deliveries(id SERIAL PRIMARY KEY);`);
        sql(readFileSync(new URL('../prisma/migrations/20261102120000_ebook_settlement/migration.sql', import.meta.url), 'utf8'));
        pool = new Pool({ connectionString: `postgresql://postgres@127.0.0.1:${port}/postgres` });
        prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
        await prisma.$executeRaw`INSERT INTO orders(id) VALUES (${manifest.orderId})`;
        await prisma.$executeRaw`INSERT INTO ebook_settlement_manifests ("manifestId","orderId",manifest) VALUES (${manifest.manifestId}::uuid,${manifest.orderId},${JSON.stringify(manifest)}::jsonb)`;
        process.env.API_MACHINE_INTERNAL_TOKEN = 'local-cross-service-test-token';
        const controller = new SettlementReceiptsController(prisma);
        const ordered = [...receipts].sort((a,b) => a.revision - b.revision);
        for (const receipt of ordered) {
            expect(await controller.receive('local-cross-service-test-token', receipt)).toEqual({ acknowledged: true, receiptId: receipt.receiptId });
        }
        for (const receipt of [...ordered].reverse()) await controller.receive('local-cross-service-test-token', receipt);
        const rows = await prisma.$queryRaw`SELECT revision,projection FROM ebook_settlement_manifests`;
        expect(rows[0].revision).toBe(ordered.at(-1).revision);
        expect(rows[0].projection).toEqual(ordered.at(-1));
        const count = await prisma.$queryRaw`SELECT COUNT(*)::int AS n FROM ebook_settlement_receipts`;
        expect(count[0].n).toBe(new Set(ordered.map(receipt => receipt.receiptId)).size);
        const deliveries = await prisma.$queryRaw`SELECT COUNT(*)::int AS n FROM affiliate_commission_deliveries`;
        expect(deliveries[0].n).toBe(0);
        const commissions = await prisma.$queryRaw`SELECT * FROM affiliate_commissions`;
        const projectedItems = new Set(ordered.flatMap(receipt => receipt.allocations.filter(a => a.role === 'AFFILIATE').map(a => a.itemId)));
        expect(commissions.length).toBe(projectedItems.size);
        if (ordered.every(receipt => receipt.status === 'BLOCKED')) expect(commissions.length).toBe(0);
        for (const commission of commissions) expect(commission.settlementManifestId).toBe(manifest.manifestId);
        const tampered = { ...ordered[0], grossCents: ordered[0].grossCents + 1 };
        await expect(controller.receive('local-cross-service-test-token', tampered)).rejects.toThrow();
    } finally {
        if (prisma) await prisma.$disconnect();
        if (pool) await pool.end();
        if (oldToken === undefined) delete process.env.API_MACHINE_INTERNAL_TOKEN;
        else process.env.API_MACHINE_INTERNAL_TOKEN = oldToken;
        execFileSync('docker', ['rm', '-f', container]);
    }
}, 60000);
