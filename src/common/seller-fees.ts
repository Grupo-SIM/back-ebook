import { isCanonicalFinanceEnabled, isSimintpayPlatformConfigured, merchantFees } from './simintpay-platform';
import type { SimintpayMerchantFees } from './simintpay-platform';
import { processingPercent } from '../payments/canonical-finance';

/**
 * Taxas do vendedor vindas do método de pagamento (API Machine → /internal/ebook/finance/summary).
 * É a mesma fonte exibida em admin.ebooksim.com/taxa — todo cálculo de líquido deve usar isto.
 */
export interface SellerFees {
    /** Percentual por transação (ex.: 14.99 = 14,99%) */
    percent: number;
    /** Taxa fixa por transação em R$ */
    fixedBrl: number;
    /** Taxa fixa de saque em R$ */
    withdrawalBrl: number | null;
}

const CACHE_TTL_MS = 60 * 1000;
const cache = new Map<string, { fees: SellerFees; fetchedAt: number }>();

function toNumber(value: unknown): number | null {
    const n = typeof value === 'string' ? Number(value) : value;
    return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/** Extrai as taxas de uma resposta do /finance/summary. */
export function parseSellerFees(summary: any): SellerFees | null {
    const percent = toNumber(summary?.pixFeePercent);
    const fixedBrl = toNumber(summary?.transactionFeeBrl);
    if (percent === null || fixedBrl === null) return null;
    return { percent, fixedBrl, withdrawalBrl: toNumber(summary?.withdrawalFeeBrl) };
}

/**
 * finance/fees canônico → SellerFees: percentual = taxa de processamento real (taxa alvo, ex.: 14.99),
 * fixa = taxa de serviço por venda (mesma TAXA_SERVICO do legado `transactionFeeBrl`), saque = taxa fixa de saque.
 */
export function sellerFeesFromCanonical(fees: SimintpayMerchantFees): SellerFees | null {
    const percent = processingPercent(fees);
    if (percent === null || !Number.isFinite(fees.transaction?.serviceFeeCents)) return null;
    return {
        percent,
        fixedBrl: fees.transaction.serviceFeeCents / 100,
        withdrawalBrl: Number.isFinite(fees.withdrawal?.fixedFeeCents) ? fees.withdrawal.fixedFeeCents / 100 : null,
    };
}

/** Busca as taxas do vendedor pelo CPF/CNPJ. Retorna null se a API de pagamento não responder. */
export async function getSellerFees(document: string | null | undefined): Promise<SellerFees | null> {
    const doc = String(document ?? '').replace(/\D/g, '');
    if (doc.length !== 11 && doc.length !== 14) return null;

    const cached = cache.get(doc);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.fees;

    // Canônico (flag ligada): finance/fees. Vendedor não provisionado/erro → cai no legado abaixo.
    if (isCanonicalFinanceEnabled() && isSimintpayPlatformConfigured()) {
        try {
            const fees = sellerFeesFromCanonical(await merchantFees(doc));
            if (fees) {
                cache.set(doc, { fees, fetchedAt: Date.now() });
                return fees;
            }
        } catch {
            // fallback legado
        }
    }

    const base = process.env.API_MACHINE_URL || process.env.API_MACHINE_INTERNAL_URL;
    const token = process.env.API_MACHINE_INTERNAL_TOKEN || process.env.INTERNAL_SERVICE_TOKEN;
    if (!base || !token) return null;

    try {
        const res = await fetch(
            `${base.replace(/\/+$/, '')}/internal/ebook/finance/summary?${new URLSearchParams({ cpf: doc })}`,
            { headers: { 'x-internal-token': token, 'Content-Type': 'application/json' } },
        );
        if (!res.ok) return null;
        const fees = parseSellerFees(await res.json());
        if (fees) cache.set(doc, { fees, fetchedAt: Date.now() });
        return fees;
    } catch {
        return null;
    }
}

/** Líquido = bruto − (bruto × percentual + fixo), arredondado em centavos. */
export function calcNetAmount(gross: number, fees: SellerFees): number {
    const fee = gross * (fees.percent / 100) + fees.fixedBrl;
    return Number((gross - fee).toFixed(2));
}
