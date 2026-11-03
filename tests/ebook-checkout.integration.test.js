import { test, expect } from 'bun:test';
import { CheckoutService } from '../src/checkout/checkout.service';
import { SettlementReceiptsController } from '../src/checkout/settlement-receipts.controller';
import { manifestHash } from '../src/checkout/ebook-settlement';

// Exercise real checkout orchestration against a local HTTP server, never an external service.
test('checkout retries retain manifest and price; authenticated receipts reject tampering', async () => {
    const previousToken = process.env.API_MACHINE_INTERNAL_TOKEN;
    process.env.API_MACHINE_INTERNAL_TOKEN = 'local-disposable-test-token';
    const manifest = { version: 1, manifestId: '12345678-1234-4234-8234-123456789012', orderId: 1, orderNumber: 'test', currency: 'BRL', grossCents: 1000, items: [], fixedFeeSnapshot: {} };
    const row = { manifest, settlementId: null, manifestHash: null, revision: -1 };
    const prisma = {
        $transaction: async callback => callback(prisma),
        $queryRaw: async strings => String(strings).includes('SELECT id FROM orders') ? [] : [row],
        $executeRaw: async () => 1,
    };
    let attempts = 0;
    let received;
    const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
        received = await request.json();
        expect(request.headers.get('x-internal-token')).toBe('local-disposable-test-token');
        attempts++;
        return attempts === 1 ? new Response('retry', { status: 503 }) : Response.json({ checkoutUrl: 'https://example.invalid/checkout', settlementId: 's1', manifestHash: manifestHash(manifest) });
    } });
    try {
        const service = new CheckoutService(prisma, {}, {}, {});
        service.getApiMachineBaseUrl = () => `http://127.0.0.1:${server.port}`;
        const params = { value: 1000, description: 'test', orderId: 1, orderNumber: 'test' };
        await expect(service.buildCheckoutUrl(params)).rejects.toThrow();
        expect(row.manifest).toEqual(manifest);
        expect(await service.buildCheckoutUrl(params)).toBe('https://example.invalid/checkout');
        expect(received.settlement).toEqual(manifest);
        expect(Number(received.value)).toBe(1000);
        await expect(service.buildCheckoutUrl({ ...params, value: 11 })).rejects.toThrow();
        expect(attempts).toBe(2);
        const originalQuery = prisma.$queryRaw;
        prisma.$queryRaw = async () => [];
        expect(await service.buildCheckoutUrl({ ...params, existingOnly: true })).toBe('');
        expect(attempts).toBe(2);
        prisma.$queryRaw = originalQuery;
        const controller = new SettlementReceiptsController(prisma);
        await expect(controller.receive('wrong', {})).rejects.toThrow();
        const receipt = { version: 1, receiptId: 'r1', settlementId: 's1', manifestId: manifest.manifestId, manifestHash: '0'.repeat(64), orderId: 1, orderNumber: 'test', transactionId: 't1', revision: 1, status: 'SETTLED', grossCents: 1000, allocations: [] };
        await expect(controller.receive('local-disposable-test-token', receipt)).rejects.toThrow('Settlement identity mismatch');
    } finally {
        server.stop(true);
        if (previousToken === undefined) delete process.env.API_MACHINE_INTERNAL_TOKEN;
        else process.env.API_MACHINE_INTERNAL_TOKEN = previousToken;
    }
});
