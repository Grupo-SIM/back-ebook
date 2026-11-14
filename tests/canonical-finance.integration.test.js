import { test, expect } from 'bun:test';
import { PaymentsController } from '../src/payments/payments.controller';
import { grossForNet, isCanonicalFinanceEnabled, mapCanonicalWithdrawals, withdrawalFeeCents, withdrawalIdempotencyKey } from '../src/payments/canonical-finance';
import { merchantIdFromDocument } from '../src/common/simintpay-platform';

const CPF = '52998224725';
const ENV = ['SIMINTPAY_URL', 'SIMINTPAY_PLATFORM_TOKEN', 'API_MACHINE_URL', 'API_MACHINE_INTERNAL_TOKEN', 'EBOOK_CANONICAL_FINANCE'];

async function withFakeSimintpay(handler, run) {
    const saved = Object.fromEntries(ENV.map(k => [k, process.env[k]]));
    const calls = [];
    const server = Bun.serve({ port: 0, fetch: async request => {
        const url = new URL(request.url);
        const body = request.method === 'GET' ? null : await request.json();
        calls.push({ method: request.method, path: url.pathname + url.search, token: request.headers.get('x-access-token'), internal: request.headers.get('x-internal-token'), body });
        return handler(request.method, url.pathname, body) ?? new Response('{}', { status: 404 });
    } });
    process.env.SIMINTPAY_URL = `http://localhost:${server.port}`;
    process.env.API_MACHINE_URL = `http://localhost:${server.port}`;
    process.env.SIMINTPAY_PLATFORM_TOKEN = 'inbound-secret';
    process.env.API_MACHINE_INTERNAL_TOKEN = 'legacy-secret';
    try { await run(calls); } finally {
        server.stop(true);
        for (const k of ENV) if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
}

const prisma = {
    user: { findUnique: async () => ({ cpf: CPF, cnpj: null, name: 'Maria', email: 'm@x.com' }) },
    order: { findMany: async () => [{ netAmount: 10, totalAmount: 12 }] },
};
const user = { id: 'u1' };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
const legacySummary = { minimumWithdrawalAmount: 20, withdrawalFeeBrl: 3.5, pixFeePercent: 4.99, transactionFeeBrl: 1, accountExists: true, availableBalance: 999 };
const canonicalSummary = { balanceCents: 15000, availableBalanceCents: 12345, lockedBalanceCents: 2655, pendingPlatformWithdrawalsCents: 2655, feePolicy: { fixedCents: 350, rate: 0.01 } };

test('flag off keeps the legacy path untouched', async () => {
    expect(isCanonicalFinanceEnabled({})).toBe(false);
    expect(isCanonicalFinanceEnabled({ EBOOK_CANONICAL_FINANCE: 'TRUE' })).toBe(true);
    await withFakeSimintpay((method, path) => path === '/internal/ebook/finance/summary' ? json(legacySummary) : null, async calls => {
        delete process.env.EBOOK_CANONICAL_FINANCE;
        const result = await new PaymentsController(prisma).summary(user);
        expect(result.availableBalance).toBe(999);
        expect(calls.map(c => c.path.split('?')[0])).toEqual(['/internal/ebook/finance/summary']);
        expect(calls[0].internal).toBe('legacy-secret');
    });
});

test('flag on: summary maps cents to reais and borrows missing fee fields from legacy', async () => {
    await withFakeSimintpay((method, path) => {
        if (path === `/platforms/EBOOK/merchants/${CPF}/finance/summary`) return json(canonicalSummary);
        if (path === '/internal/ebook/finance/summary') return json(legacySummary);
    }, async calls => {
        process.env.EBOOK_CANONICAL_FINANCE = 'true';
        const result = await new PaymentsController(prisma).summary(user);
        expect(result).toMatchObject({ availableBalance: 123.45, lockedBalance: 26.55, pendingWithdraws: 26.55, withdrawalFeeBrl: 3.5, minimumWithdrawalAmount: 20, pixFeePercent: 4.99, transactionFeeBrl: 1, accountExists: true });
        expect(calls[0].token).toBe('inbound-secret');
    });
});

test('flag on: 404 Comerciante não associado => accountExists false with local estimate', async () => {
    await withFakeSimintpay((method, path) => {
        if (path.includes('/platforms/')) return new Response('{"message":"Comerciante não associado ou inativo"}', { status: 404 });
        if (path === '/internal/ebook/finance/summary') return json(legacySummary);
    }, async () => {
        process.env.EBOOK_CANONICAL_FINANCE = 'true';
        const result = await new PaymentsController(prisma).summary(user);
        expect(result.accountExists).toBe(false);
        expect(result.estimatedLocalBalance).toBe(true);
        expect(result.availableBalance).toBe(10);
    });
});

test('flag on: withdraw converts net to gross, quotes and sends a deterministic idempotency key', async () => {
    await withFakeSimintpay((method, path, body) => {
        if (path.endsWith('/finance/summary')) return json(canonicalSummary);
        if (path.endsWith('/withdrawals/quote')) {
            const fee = withdrawalFeeCents(body.amountCents, canonicalSummary.feePolicy);
            return json({ feeCents: fee, grossAmountCents: body.amountCents, netAmountCents: body.amountCents - fee });
        }
        if (path.endsWith('/finance/withdrawals')) return json({ id: 'w1', status: 'PENDING' });
    }, async calls => {
        process.env.EBOOK_CANONICAL_FINANCE = 'true';
        const controller = new PaymentsController(prisma);
        const first = await controller.withdraw(user, { amount: 100, pixKey: CPF });
        expect(first).toEqual({ success: true, id: 'w1', status: 'PENDING' });
        const posts = calls.filter(c => c.path.endsWith('/finance/withdrawals'));
        expect(posts[0].body.amountCents - withdrawalFeeCents(posts[0].body.amountCents, canonicalSummary.feePolicy)).toBeGreaterThanOrEqual(10000);
        expect(posts[0].body.idempotencyKey).toMatch(/^ebook-[0-9a-f]{40}$/);
        const clientKey = await controller.withdraw(user, { amount: 100, pixKey: CPF, idempotencyKey: 'abc-1' });
        expect(clientKey.id).toBe('w1');
        expect(calls.filter(c => c.path.endsWith('/finance/withdrawals')).at(-1).body.idempotencyKey).toBe('abc-1');
    });
});

test('pure helpers: gross/net inversion, idempotency bucket and withdrawals mapping', () => {
    const policy = { fixedCents: 350, rate: 0.01 };
    for (const net of [2000, 10000, 12345]) {
        const gross = grossForNet(net, policy);
        expect(gross - withdrawalFeeCents(gross, policy)).toBeGreaterThanOrEqual(net);
        expect(gross - 1 - withdrawalFeeCents(gross - 1, policy)).toBeLessThan(net);
    }
    const a = withdrawalIdempotencyKey({ userId: 'u', grossCents: 100, pixKey: 'k', now: 60_000 });
    expect(withdrawalIdempotencyKey({ userId: 'u', grossCents: 100, pixKey: 'k', now: 119_999 })).toBe(a);
    expect(withdrawalIdempotencyKey({ userId: 'u', grossCents: 100, pixKey: 'k', now: 120_000 })).not.toBe(a);
    expect(() => withdrawalIdempotencyKey({ userId: 'u', grossCents: 1, pixKey: 'k', clientKey: 'bad key!' })).toThrow();
    expect(merchantIdFromDocument('529.982.247-25')).toBe(CPF);
    const mapped = mapCanonicalWithdrawals({ data: [{ id: 'w', amountCents: 1050, status: 'PENDING', pixKey: 'k', rejectionReason: null, createdAt: 'd' }], meta: { page: 2, limit: 5, total: 7, totalPages: 2 } }, { id: 'u', name: 'N', email: 'e' });
    expect(mapped).toEqual({ withdrawals: [{ id: 'w', userId: 'u', amount: 10.5, status: 'PENDING', pixKey: 'k', rejectionReason: null, createdAt: 'd', user: { name: 'N', email: 'e' } }], meta: { currentPage: 2, itemsPerPage: 5, totalItems: 7, totalPages: 2 } });
});

test('auto-provision: only seller roles with a valid document, CNPJ first, never throws, sends PUT with digits', async () => {
    const { provisionSellerMerchantInBackground, sellerDocument } = await import('../src/common/seller-provisioning');
    expect(sellerDocument({ cpf: '529.982.247-25', cnpj: null })).toBe(CPF);
    expect(sellerDocument({ cpf: CPF, cnpj: '11222333000181' })).toBe('11222333000181');
    expect(sellerDocument({ cpf: '11111111111', cnpj: null })).toBeNull();
    await withFakeSimintpay((method, path) => method === 'PUT' ? json({ id: 'm' }) : null, async calls => {
        provisionSellerMerchantInBackground({ role: 'CUSTOMER', name: 'C', cpf: CPF });
        provisionSellerMerchantInBackground({ role: 'ADMIN', name: 'Maria', cpf: CPF });
        provisionSellerMerchantInBackground({ role: 'ADMIN', name: 'Sem doc' });
        await Bun.sleep(150);
        expect(calls).toHaveLength(1);
        expect(calls[0]).toMatchObject({ method: 'PUT', path: `/platforms/EBOOK/merchants/${CPF}`, token: 'inbound-secret', body: { cnpj: CPF, legalName: 'Maria' } });
    });
    // 400 (no SimIntPay account) and unreachable server are swallowed
    await withFakeSimintpay(() => new Response('Comerciante exige conta ativa previamente cadastrada', { status: 400 }), async () => {
        provisionSellerMerchantInBackground({ role: 'USER', name: 'Maria', cpf: CPF });
        await Bun.sleep(100);
    });
    delete process.env.SIMINTPAY_PLATFORM_TOKEN;
    provisionSellerMerchantInBackground({ role: 'USER', name: 'Maria', cpf: CPF });
});
