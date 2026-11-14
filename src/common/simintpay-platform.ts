/**
 * Cliente das rotas canônicas por comerciante do SimIntPay (`/platforms/EBOOK/merchants/:id/...`).
 *
 * - Base: SIMINTPAY_URL (fallback API_MACHINE_URL / API_MACHINE_INTERNAL_URL — mesmo host).
 * - Autenticação: SIMINTPAY_PLATFORM_TOKEN (INBOUND_TOKEN da plataforma EBOOK) no header `x-access-token`.
 *   O token nunca é logado nem incluído em mensagens de erro.
 * - Valores trafegam em centavos. O externalMerchantId é sempre o CPF/CNPJ (somente dígitos) do vendedor.
 */

export const SIMINTPAY_PLATFORM_TAG = 'EBOOK';

/** Rotas financeiras canônicas só valem com EBOOK_CANONICAL_FINANCE=true (padrão: desligado → caminho legado). */
export function isCanonicalFinanceEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return String(env.EBOOK_CANONICAL_FINANCE ?? '').trim().toLowerCase() === 'true';
}

export class SimintpayPlatformError extends Error {
    constructor(
        readonly status: number,
        readonly body: string,
        readonly path: string,
    ) {
        super(`SimIntPay ${status} em ${path}: ${body.slice(0, 300)}`);
        this.name = 'SimintpayPlatformError';
    }
}

export type SimintpayMerchantSummary = {
    balanceCents: number;
    availableBalanceCents: number;
    lockedBalanceCents: number;
    pendingPlatformWithdrawalsCents: number;
    feePolicy?: { fixedCents: number; rate: number };
    canRequest?: boolean;
    blockReason?: string | null;
    processingCount?: number;
    processingGrossCents?: number;
    [key: string]: unknown;
};

export type SimintpayWithdrawal = {
    id: string;
    amountCents: number; // líquido
    grossAmountCents: number;
    feeCents: number;
    pixKey: string;
    status: string;
    rejectionReason: string | null;
    requestId: string | null;
    createdAt: string;
    updatedAt: string;
};

type ModalityFees = {
    available: boolean;
    processingFeeCents?: number;
    processingRatePpm?: number;
    netCents?: number;
    installments?: number;
    [key: string]: unknown;
};

/** GET finance/fees: taxas reais do vendedor (centavos; ppm: 149900 = 14,99%; netCents sobre referenceAmountCents). */
export type SimintpayMerchantFees = {
    withdrawal: { minimumCents: number; fixedFeeCents: number; percentFee: number };
    transaction: { serviceFeeCents: number; fixedFeeCents: number; cashbackCents?: number };
    referenceAmountCents?: number;
    effectiveTargetFeePpm?: number;
    pix?: ModalityFees;
    debit?: ModalityFees;
    boleto?: ModalityFees;
    credit?: ModalityFees[];
};

/** GET /platforms/EBOOK/finance/config (nível plataforma, sem comerciante). */
export type SimintpayPlatformConfig = {
    liquidityRate?: number;
    transactionFeeCents?: number;
    withdrawal?: { minimumCents: number; fixedFeeCents: number; percentFee: number };
    [key: string]: unknown;
};

export type SimintpayTransaction = {
    id: string;
    amountCents: number;
    netAmountCents: number;
    platformFeeCents: number;
    acquirerFeeCents: number;
    transactionFeeCents: number;
    sellerNetCents: number;
    status: string;
    paymentMethod: string | null;
    description: string | null;
    customerName: string | null;
    customerEmail: string | null;
    customerPhone: string | null;
    customerDocument: string | null;
    createdAt: string;
};

export type SimintpayTransactionPage = {
    data: SimintpayTransaction[];
    meta: { page: number; limit: number; total: number; totalPages: number };
};

export type SimintpayEntryInput = {
    referenceId: string;
    kind: 'pending' | 'commission';
    amountCents: number;
    netAmountCents: number;
    paymentMethod: 'PIX' | 'CREDIT_CARD';
    installments?: number;
    description?: string;
    customerName?: string;
    customerEmail?: string;
    customerDocument?: string;
};

export type SimintpayQuote = { feeCents: number; grossAmountCents: number; netAmountCents: number };

export type SimintpayWithdrawalPage = {
    data: SimintpayWithdrawal[];
    meta: { page: number; limit: number; total: number; totalPages: number };
};

export function isSimintpayPlatformConfigured(): boolean {
    return !!(baseUrl() && process.env.SIMINTPAY_PLATFORM_TOKEN);
}

function baseUrl(): string | null {
    const base = process.env.SIMINTPAY_URL || process.env.API_MACHINE_URL || process.env.API_MACHINE_INTERNAL_URL;
    return base ? base.replace(/\/+$/, '') : null;
}

/** CPF/CNPJ somente dígitos — é o externalMerchantId. */
export function merchantIdFromDocument(document: string | null | undefined): string {
    return String(document ?? '').replace(/\D/g, '');
}

async function request<T>(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown): Promise<T> {
    const base = baseUrl();
    const token = process.env.SIMINTPAY_PLATFORM_TOKEN;
    if (!base || !token) throw new Error('SIMINTPAY_URL/SIMINTPAY_PLATFORM_TOKEN não configurados');
    const response = await fetch(`${base}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', 'x-access-token': token },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
    });
    const text = await response.text();
    if (!response.ok) throw new SimintpayPlatformError(response.status, text, path);
    return (text ? JSON.parse(text) : {}) as T;
}

const merchantPath = (document: string) =>
    `/platforms/${SIMINTPAY_PLATFORM_TAG}/merchants/${encodeURIComponent(merchantIdFromDocument(document))}`;

/** PUT idempotente. Exige usuário SimIntPay ativo que já possua o CPF/CNPJ (senão 400). Escopo merchants:manage. */
export function provisionMerchant(document: string, legalName: string) {
    const digits = merchantIdFromDocument(document);
    return request<{ cnpj: string; externalMerchantId: string; id: string; legalName: string }>(
        'PUT',
        merchantPath(digits),
        { cnpj: digits, legalName: legalName.trim() },
    );
}

export function merchantSummary(document: string) {
    return request<SimintpayMerchantSummary>('GET', `${merchantPath(document)}/finance/summary`);
}

export function merchantFees(document: string) {
    return request<SimintpayMerchantFees>('GET', `${merchantPath(document)}/finance/fees`);
}

export function merchantTransactions(
    document: string,
    query: { page?: number; limit?: number; startDate?: string; endDate?: string; status?: string; description?: string },
) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null && `${value}` !== '') search.set(key, String(value));
    }
    return request<SimintpayTransactionPage>('GET', `${merchantPath(document)}/finance/transactions?${search}`);
}

/** Escopo ledger:write. Idempotente por referenceId (409 se o replay divergir). */
export function merchantEntry(document: string, entry: SimintpayEntryInput) {
    return request<{ success: boolean; id: string; created: boolean }>('POST', `${merchantPath(document)}/finance/entries`, entry);
}

export function platformFinanceConfig() {
    return request<SimintpayPlatformConfig>('GET', `/platforms/${SIMINTPAY_PLATFORM_TAG}/finance/config`);
}

export function merchantWithdrawals(document: string, page: number, limit: number) {
    const search = new URLSearchParams({ page: String(page), limit: String(limit) });
    return request<SimintpayWithdrawalPage>('GET', `${merchantPath(document)}/finance/withdrawals?${search}`);
}

export function merchantQuote(document: string, amountCents: number) {
    return request<SimintpayQuote>('POST', `${merchantPath(document)}/finance/withdrawals/quote`, { amountCents });
}

export function merchantWithdraw(
    document: string,
    input: { amountCents: number; pixKey: string; idempotencyKey: string },
) {
    return request<{ id: string; status: string; [key: string]: unknown }>(
        'POST',
        `${merchantPath(document)}/finance/withdrawals`,
        input,
    );
}

/** 404 "Comerciante não associado ou inativo": o CPF/CNPJ ainda não foi provisionado. */
export function isMerchantNotAssociated(error: unknown): boolean {
    return error instanceof SimintpayPlatformError && error.status === 404 && /Comerciante/i.test(error.body);
}

/** 400 "Comerciante exige conta ativa previamente cadastrada": o vendedor não tem conta SimIntPay com esse documento. */
export function isMerchantWithoutAccount(error: unknown): boolean {
    return error instanceof SimintpayPlatformError && error.status === 400 && /conta ativa/i.test(error.body);
}

export type ProvisionOutcome = 'provisioned' | 'no-account' | 'invalid-document' | 'error' | 'disabled';

/** Provisiona sem nunca lançar; erros são logados sem segredos. */
export async function provisionMerchantSafe(
    document: string | null | undefined,
    legalName: string | null | undefined,
    logger: Pick<Console, 'warn'> = console,
): Promise<ProvisionOutcome> {
    const digits = merchantIdFromDocument(document);
    if (!isSimintpayPlatformConfigured()) return 'disabled';
    if (!legalName?.trim()) return 'invalid-document';
    try {
        await provisionMerchant(digits, legalName);
        return 'provisioned';
    } catch (error) {
        if (isMerchantWithoutAccount(error)) return 'no-account';
        if (error instanceof SimintpayPlatformError && error.status === 400 && /inválido/i.test(error.body)) {
            return 'invalid-document';
        }
        const status = error instanceof SimintpayPlatformError ? error.status : 'rede';
        logger.warn(`[simintpay] falha ao provisionar comerciante ***${digits.slice(-4)} (${status})`);
        return 'error';
    }
}
