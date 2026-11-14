import { test, expect } from 'bun:test';
import { PaymentsController } from '../src/payments/payments.controller';
import { isCanonicalFinanceEnabled, mapCanonicalWithdrawals, withdrawalFeeCents, withdrawalIdempotencyKey } from '../src/payments/canonical-finance';
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

const canonicalFees = { withdrawal: { minimumCents: 10000, fixedFeeCents: 350, percentFee: 0.01 }, transaction: { serviceFeeCents: 400, fixedFeeCents: 100 }, pix: { available: true, processingRatePpm: 149900, netCents: 8501 }, credit: [] };

test('flag on: summary maps cents to reais using the real fees (target rate, not legacy 6.99)', async () => {
    await withFakeSimintpay((method, path) => {
        if (path === `/platforms/EBOOK/merchants/${CPF}/finance/summary`) return json(canonicalSummary);
        if (path === `/platforms/EBOOK/merchants/${CPF}/finance/fees`) return json(canonicalFees);
    }, async calls => {
        process.env.EBOOK_CANONICAL_FINANCE = 'true';
        const result = await new PaymentsController(prisma).summary(user);
        expect(result).toMatchObject({ availableBalance: 123.45, lockedBalance: 26.55, pendingWithdraws: 26.55, withdrawalFeeBrl: 3.5, minimumWithdrawalAmount: 100, pixFeePercent: 14.99, transactionFeeBrl: 4, accountExists: true });
        expect(calls.every(c => c.token === 'inbound-secret')).toBe(true);
    });
});

test('flag on: 404 Comerciante não associado => accountExists false with local estimate', async () => {
    await withFakeSimintpay((method, path) => {
        if (path.includes('/platforms/')) return new Response('{"message":"Comerciante não associado ou inativo"}', { status: 404 });
        if (path === '/platforms/EBOOK/finance/config') return json({ liquidityRate: 0.8501, transactionFeeCents: 400, withdrawal: { minimumCents: 10000, fixedFeeCents: 350, percentFee: 0 } });
    }, async () => {
        process.env.EBOOK_CANONICAL_FINANCE = 'true';
        const result = await new PaymentsController(prisma).summary(user);
        expect(result.accountExists).toBe(false);
        expect(result.estimatedLocalBalance).toBe(true);
        expect(result.availableBalance).toBe(10);
    });
});

test('flag on: withdraw amount is GROSS, quotes first, enforces the minimum and returns gross/fee/net', async () => {
    const handler = (method, path, body) => {
        if (path.endsWith('/finance/fees')) return json(canonicalFees);
        if (path.endsWith('/withdrawals/quote')) { const fee = withdrawalFeeCents(body.amountCents, { fixedCents: 350, rate: 0.01 }); return json({ feeCents: fee, grossAmountCents: body.amountCents, netAmountCents: body.amountCents - fee }); }
        if (path.endsWith('/finance/withdrawals')) return json({ id: 'w1', status: 'PENDING', amountCents: body.amountCents - 450, grossAmountCents: body.amountCents, feeCents: 450 });
    };
    await withFakeSimintpay(handler, async calls => {
        process.env.EBOOK_CANONICAL_FINANCE = 'true';
        const controller = new PaymentsController(prisma);
        const quote = await controller.withdrawQuote(user, { amount: 100 });
        expect(quote).toEqual({ grossAmount: 100, fee: 4.5, netAmount: 95.5, minimumWithdrawalAmount: 100 });
        const first = await controller.withdraw(user, { amount: 100, pixKey: CPF });
        expect(first).toEqual({ success: true, id: 'w1', status: 'PENDING', grossAmount: 100, fee: 4.5, amount: 95.5 });
        const post = calls.filter(c => c.method === 'POST' && c.path.endsWith('/finance/withdrawals')).at(0);
        expect(post.body.amountCents).toBe(10000);
        expect(post.body.idempotencyKey).toMatch(/^ebook-[0-9a-f]{40}$/);
        await controller.withdraw(user, { amount: 100, pixKey: CPF, idempotencyKey: 'abc-1' });
        expect(calls.filter(c => c.path.endsWith('/finance/withdrawals')).at(-1).body.idempotencyKey).toBe('abc-1');
        await expect(controller.withdraw(user, { amount: 50, pixKey: CPF })).rejects.toThrow('Valor mínimo');
    });
});

test('flag on: withdrawals history shows gross, fee and net; transactions come from the canonical list', async () => {
    await withFakeSimintpay((method, path) => {
        if (path.endsWith('/finance/withdrawals')) return json({ data: [{ id: 'w1', amountCents: 9550, grossAmountCents: 10000, feeCents: 450, status: 'PENDING', pixKey: 'k', rejectionReason: null, createdAt: 'd' }], meta: { page: 1, limit: 10, total: 1, totalPages: 1 } });
        if (path.endsWith('/finance/transactions')) return json({ data: [{ id: 't1', amountCents: 10000, netAmountCents: 8501, platformFeeCents: 1499, acquirerFeeCents: 0, transactionFeeCents: 400, sellerNetCents: 8101, status: 'COMPLETED', paymentMethod: 'PIX', description: 'ORD-2026-000001 [TENANT:EBOOK]', customerName: 'Ana', customerEmail: 'a@x.com', customerDocument: null, createdAt: '2026-11-14T12:00:00.000Z' }], meta: { page: 1, limit: 200, total: 1, totalPages: 1 } });
    }, async calls => {
        process.env.EBOOK_CANONICAL_FINANCE = 'true';
        const controller = new PaymentsController(prisma);
        const history = await controller.withdrawals(user);
        expect(history.withdrawals[0]).toMatchObject({ grossAmount: 100, fee: 4.5, amount: 95.5, netAmount: 95.5 });
        const txs = await controller.allTransactionsExcel(user, undefined, undefined, 'PAID');
        expect(txs[0]).toMatchObject({ amount: 100, amountWithoutAllFee: 81.01, fee: 14.99, taxa_fixa_transacao: 4, status: 'COMPLETED' });
        expect(calls.at(-1).path).toContain('status=PAID');
    });
});

test('pending entry, platform config and commission go through canonical routes when the flag is on', async () => {
    const { tryCanonicalPendingEntry, canonicalPlatformFees } = await import('../src/checkout/canonical-pending-entry');
    const { retryCommissionDeliveries } = await import('../src/affiliate/commission-delivery');
    await withFakeSimintpay((method, path, body) => {
        if (path.endsWith('/finance/fees')) return json(canonicalFees);
        if (path.endsWith('/finance/entries')) return json(body?.kind === 'commission' ? { success: true, created: false, skipped: 'SETTLEMENT_CREDITS_AFFILIATE' } : { success: true, id: 'e', created: true });
        if (path === '/platforms/EBOOK/finance/config') return json({ liquidityRate: 0.8501, transactionFeeCents: 400 });
    }, async calls => {
        delete process.env.EBOOK_CANONICAL_FINANCE;
        expect(await tryCanonicalPendingEntry({ orderNumber: 'ORD-1', amount: 100, ownerDocument: CPF })).toBe(false);
        expect(calls).toHaveLength(0);
        process.env.EBOOK_CANONICAL_FINANCE = 'true';
        expect(await tryCanonicalPendingEntry({ orderNumber: 'ORD-1', amount: 100, ownerDocument: CPF, ownerName: 'Maria', buyer: { email: 'b@x.com' } })).toBe(true);
        const entry = calls.find(c => c.path.endsWith('/finance/entries'));
        expect(entry.path).toBe(`/platforms/EBOOK/merchants/${CPF}/finance/entries`);
        expect(entry.body).toMatchObject({ referenceId: 'ORD-1', kind: 'pending', amountCents: 10000, paymentMethod: 'PIX', installments: 1, description: `ORD-1 [CPF_DONO:${CPF}] [NOME_DONO:Maria]` });
        // o líquido é do SimIntPay: nunca enviamos netAmountCents nem consultamos finance/fees para calculá-lo
        expect(entry.body).not.toHaveProperty('netAmountCents');
        expect(calls.some(c => c.path.endsWith('/finance/fees'))).toBe(false);
        expect(await canonicalPlatformFees()).toMatchObject({ liquidez: 0.8501, taxaFixa: 4 });

        const updates = [];
        const prismaStub = {
            $queryRaw: async () => (updates.length ? [] : [{ id: 7, snapshot: { referenceId: 'AFF-1-2', orderNumber: 'ORD-9', cpf: CPF, cnpj: null, amount: 8, description: 'comissao' } }]),
            $executeRaw: async (parts) => { updates.push(parts.join('?')); },
        };
        await retryCommissionDeliveries(prismaStub, 2);
        const commission = calls.filter(c => c.path.endsWith('/finance/entries')).at(-1);
        expect(commission.body).toMatchObject({ referenceId: 'AFF-1-2', orderNumber: 'ORD-9', kind: 'commission', amountCents: 800, paymentMethod: 'PIX' });
        expect(commission.body).not.toHaveProperty('netAmountCents');
        expect(updates[0]).toContain("'ACKNOWLEDGED'");
        expect(calls.some(c => c.internal)).toBe(false);
    });
});

test('pure helpers: gross/net inversion, idempotency bucket and withdrawals mapping', () => {
    const a = withdrawalIdempotencyKey({ userId: 'u', grossCents: 100, pixKey: 'k', now: 60_000 });
    expect(withdrawalIdempotencyKey({ userId: 'u', grossCents: 100, pixKey: 'k', now: 119_999 })).toBe(a);
    expect(withdrawalIdempotencyKey({ userId: 'u', grossCents: 100, pixKey: 'k', now: 120_000 })).not.toBe(a);
    expect(() => withdrawalIdempotencyKey({ userId: 'u', grossCents: 1, pixKey: 'k', clientKey: 'bad key!' })).toThrow();
    expect(merchantIdFromDocument('529.982.247-25')).toBe(CPF);
    const mapped = mapCanonicalWithdrawals({ data: [{ id: 'w', amountCents: 1050, status: 'PENDING', pixKey: 'k', rejectionReason: null, createdAt: 'd', grossAmountCents: 1100, feeCents: 50 }], meta: { page: 2, limit: 5, total: 7, totalPages: 2 } }, { id: 'u', name: 'N', email: 'e' });
    expect(mapped).toEqual({ withdrawals: [{ id: 'w', userId: 'u', grossAmount: 11, fee: 0.5, amount: 10.5, netAmount: 10.5, status: 'PENDING', pixKey: 'k', rejectionReason: null, createdAt: 'd', user: { name: 'N', email: 'e' } }], meta: { currentPage: 2, itemsPerPage: 5, totalItems: 7, totalPages: 2 } });
});

test('auto-provision: only seller roles with a valid document, CNPJ first, never throws, sends PUT with digits', async () => {
    const { provisionSellerMerchantInBackground, sellerDocument } = await import('../src/common/seller-provisioning');
    expect(sellerDocument({ cpf: '529.982.247-25', cnpj: null })).toBe(CPF);
    expect(sellerDocument({ cpf: CPF, cnpj: '11222333000181' })).toBe('11222333000181');
    expect(sellerDocument({ cpf: '11111111111', cnpj: null })).toBeNull();
    await withFakeSimintpay((method, path) => method === 'PUT' ? json({ id: 'm' }) : null, async calls => {
        provisionSellerMerchantInBackground({ role: 'CUSTOMER', name: 'C', email: 'c@x.com', cpf: CPF });
        provisionSellerMerchantInBackground({ role: 'ADMIN', name: 'Maria', email: 'Maria@X.com', cpf: CPF });
        provisionSellerMerchantInBackground({ role: 'ADMIN', name: 'Sem doc', email: 'd@x.com' });
        provisionSellerMerchantInBackground({ role: 'ADMIN', name: 'Sem email', cpf: CPF });
        await Bun.sleep(150);
        expect(calls).toHaveLength(1);
        expect(calls[0]).toMatchObject({ method: 'PUT', path: `/platforms/EBOOK/merchants/${CPF}`, token: 'inbound-secret', body: { cnpj: CPF, legalName: 'Maria', email: 'maria@x.com' } });
        expect(calls[0].body).not.toHaveProperty('adoptByEmail');
    });
    // 400 (no SimIntPay account) and unreachable server are swallowed
    await withFakeSimintpay(() => new Response('Comerciante exige conta ativa previamente cadastrada', { status: 400 }), async () => {
        provisionSellerMerchantInBackground({ role: 'USER', name: 'Maria', email: 'm@x.com', cpf: CPF });
        await Bun.sleep(100);
    });
    delete process.env.SIMINTPAY_PLATFORM_TOKEN;
    provisionSellerMerchantInBackground({ role: 'USER', name: 'Maria', email: 'm@x.com', cpf: CPF });
});

test('provision-merchants script: dry-run never calls the API, apply is idempotent and classifies outcomes', async () => {
    const { provisionAll, maskDocument } = await import('../scripts/provision-merchants');
    const users = [
        { id: '1', name: 'Maria', email: 'maria@x.com', role: 'ADMIN', cpf: CPF, cnpj: null },
        { id: '2', name: 'Joao', email: 'joao@x.com', role: 'USER', cpf: '11111111111', cnpj: null },
        { id: '3', name: 'Ana', email: 'ana@x.com', role: 'USER', cpf: null, cnpj: '11222333000181' },
        { id: '4', name: 'Rui', email: 'rui@x.com', role: 'USER', cpf: '39053344705', cnpj: null },
    ];
    const lines = [];
    const { SimintpayPlatformError } = await import('../src/common/simintpay-platform');
    const forbidden = () => { throw new Error('API must not be called in dry-run'); };
    const dry = await provisionAll(users, { apply: false, delayMs: 0 }, { summary: forbidden, provision: forbidden, sleep: async () => {}, log: l => lines.push(l) });
    expect(dry.counts).toMatchObject({ 'would-provision': 3, 'invalid-document': 1, error: 0 });
    expect(dry.exitCode).toBe(0);
    expect(lines.join('\n')).not.toContain(CPF);
    expect(maskDocument(CPF)).toBe('529******25');

    const provisioned = [];
    const apply = await provisionAll(users, { apply: true, delayMs: 0, adoptByEmail: true }, {
        summary: async doc => { if (doc === CPF) return {}; if (doc === '39053344705') throw new SimintpayPlatformError(500, 'boom', 'x'); throw new SimintpayPlatformError(404, 'Comerciante não associado ou inativo', 'x'); },
        provision: async (doc, name, email, options) => { provisioned.push([doc, email, options.adoptByEmail]); },
        sleep: async () => {}, log: () => {},
    });
    expect(apply.counts).toMatchObject({ 'already-ok': 1, provisioned: 1, 'invalid-document': 1, error: 1 });
    expect(provisioned).toEqual([['11222333000181', 'ana@x.com', true]]);
    expect(apply.exitCode).toBe(1);
    const noAccount = await provisionAll([users[0]], { apply: true, delayMs: 0 }, {
        summary: async () => { throw new SimintpayPlatformError(404, 'Comerciante não associado', 'x'); },
        provision: async () => { throw new SimintpayPlatformError(400, 'Comerciante exige conta ativa previamente cadastrada', 'x'); },
        sleep: async () => {}, log: () => {},
    });
    expect(noAccount.counts['no-account']).toBe(1);
    expect(noAccount.exitCode).toBe(0);
});

test('script: --adopt-by-email is opt-in (default off) and users without e-mail are skipped', async () => {
    const { parseArgs, provisionAll } = await import('../scripts/provision-merchants');
    expect(parseArgs([]).adoptByEmail).toBe(false);
    expect(parseArgs(['--adopt-by-email']).adoptByEmail).toBe(true);
    const result = await provisionAll([{ id: '1', name: 'Maria', email: '', role: 'USER', cpf: CPF, cnpj: null }], { apply: true, delayMs: 0 }, { summary: async () => { throw new Error('x'); }, provision: async () => { throw new Error('x'); }, sleep: async () => {}, log: () => {} });
    expect(result.counts['invalid-document']).toBe(1);
});

test('order payment lookup uses finance/transactions by orderNumber (no admin/transacoes-dom) and fails closed', async () => {
    const { isOrderPaymentCompleted } = await import('../src/common/simintpay-platform');
    await withFakeSimintpay((method, path) => path.endsWith('/finance/transactions') ? json({ data: [{ id: 't', status: 'COMPLETED', description: 'ORD-2026-000001 [TENANT:EBOOK]' }], meta: {} }) : null, async calls => {
        expect(await isOrderPaymentCompleted(CPF, 'ORD-2026-000001')).toBe(true);
        expect(calls[0].path).toBe(`/platforms/EBOOK/merchants/${CPF}/finance/transactions?status=COMPLETED&description=ORD-2026-000001&limit=20`);
        expect(await isOrderPaymentCompleted(CPF, 'ORD-2026-000002')).toBe(false);
    });
    await withFakeSimintpay(() => new Response('{"message":"Comerciante não associado"}', { status: 404 }), async () => {
        expect(await isOrderPaymentCompleted(CPF, 'ORD-2026-000001')).toBe(false);
    });
});

test('flag on: seller fees never fall back to the legacy API Machine summary', async () => {
    const { getSellerFees } = await import('../src/common/seller-fees');
    await withFakeSimintpay(() => null, async calls => {
        process.env.EBOOK_CANONICAL_FINANCE = 'true';
        expect(await getSellerFees('11222333000181')).toBeNull();
        expect(calls.some(c => c.internal || c.path.startsWith('/internal/'))).toBe(false);
    });
});
