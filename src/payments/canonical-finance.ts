import { createHash } from 'node:crypto';
import type {
  SimintpayMerchantFees,
  SimintpayMerchantSummary,
  SimintpayPlatformConfig,
  SimintpayQuote,
  SimintpayTransaction,
  SimintpayWithdrawalPage,
} from 'src/common/simintpay-platform';

export { isCanonicalFinanceEnabled } from 'src/common/simintpay-platform';

const reais = (cents: unknown): number => Number((Number(cents ?? 0) / 100).toFixed(2));

/** Taxa de processamento PIX em % (processingRatePpm 149900 → 14.99). Sem PIX disponível, tenta débito/crédito à vista. */
export function processingPercent(fees: SimintpayMerchantFees): number | null {
  const candidates = [fees.pix, fees.debit, fees.credit?.find((c) => c.installments === 1)];
  const found = candidates.find((m) => m?.available && Number.isFinite(Number(m.processingRatePpm)));
  return found ? Number((Number(found.processingRatePpm) / 10_000).toFixed(4)) : null;
}

/**
 * Converte summary + fees canônicos (centavos) para o formato legado do frontend (R$).
 * O saldo já vem escopado à plataforma EBOOK. `pixFeePercent` é a taxa alvo real (ex.: 14.99), não mais os 6.99 do legado;
 * `feePolicy`/`withdrawal` descrevem a taxa de SAQUE (fixa + percentual), `transaction.serviceFeeCents` a taxa fixa por venda.
 */
export function mapCanonicalSummary(canonical: SimintpayMerchantSummary, fees: SimintpayMerchantFees | null) {
  const policy = fees?.withdrawal ?? null;
  return {
    availableBalance: reais(canonical.availableBalanceCents),
    pendingWithdraws: reais(canonical.pendingPlatformWithdrawalsCents),
    lockedBalance: reais(canonical.lockedBalanceCents),
    minimumWithdrawalAmount: policy ? reais(policy.minimumCents) : undefined,
    withdrawalFeeBrl: policy ? reais(policy.fixedFeeCents) : canonical.feePolicy ? reais(canonical.feePolicy.fixedCents) : undefined,
    withdrawalFeePercent: policy ? Number(policy.percentFee) : canonical.feePolicy ? Number(canonical.feePolicy.rate) : undefined,
    pixFeePercent: fees ? processingPercent(fees) ?? undefined : undefined,
    transactionFeeBrl: fees ? reais(fees.transaction.serviceFeeCents) : undefined,
    accountExists: true,
  };
}

/** Sem comerciante: usa a config da plataforma (liquidityRate é só o atalho LIQUIDEZ, usado como aproximação). */
export function mapPlatformConfigFallback(config: SimintpayPlatformConfig | null) {
  return {
    availableBalance: 0,
    pendingWithdraws: 0,
    lockedBalance: 0,
    minimumWithdrawalAmount: config?.withdrawal ? reais(config.withdrawal.minimumCents) : undefined,
    withdrawalFeeBrl: config?.withdrawal ? reais(config.withdrawal.fixedFeeCents) : undefined,
    pixFeePercent:
      typeof config?.liquidityRate === 'number' ? Number(((1 - config.liquidityRate) * 100).toFixed(2)) : undefined,
    transactionFeeBrl: typeof config?.transactionFeeCents === 'number' ? reais(config.transactionFeeCents) : undefined,
    accountExists: false,
  };
}

/** Transação canônica → formato legado (R$) usado por Relatórios/Dashboard/Excel. COMPLETED→PAID é feito pelo controller. */
export function mapCanonicalTransaction(tx: SimintpayTransaction) {
  return {
    id: tx.id,
    userId: null,
    amount: reais(tx.amountCents),
    name: tx.customerName,
    email: tx.customerEmail,
    status: tx.status,
    description: tx.description ?? '',
    appliedGlobalFee: false,
    fee: reais(tx.platformFeeCents),
    dom_fee: reais(tx.acquirerFeeCents),
    taxa_fixa_transacao: reais(tx.transactionFeeCents),
    payment_method: String(tx.paymentMethod ?? 'pix').toLowerCase(),
    amountWithoutAllFee: reais(tx.sellerNetCents),
    walletId: null,
    createdAt: tx.createdAt,
    paymentId: tx.id,
    updatedAt: tx.createdAt,
  };
}

/** PIX/cartão: o canônico só aceita PIX e CREDIT_CARD. */
export function entryPaymentMethod(method?: string | null): 'PIX' | 'CREDIT_CARD' {
  return /card|credit|cart/i.test(String(method ?? '')) ? 'CREDIT_CARD' : 'PIX';
}

/** Taxa de processamento (%) da modalidade/parcelas do pedido; null se indisponível. */
export function entryPercent(fees: SimintpayMerchantFees, method: 'PIX' | 'CREDIT_CARD', installments = 1): number | null {
  const modality =
    method === 'PIX' ? fees.pix : fees.credit?.find((c) => c.installments === installments) ?? fees.credit?.[0];
  return modality?.available && Number.isFinite(Number(modality.processingRatePpm))
    ? Number(modality.processingRatePpm) / 10_000
    : null;
}

/** Líquido do lançamento (netAmountCents) = bruto − bruto × taxa de processamento (a taxa fixa por venda é aplicada à parte pelo SimIntPay). */
export function entryNetCents(amountCents: number, percent: number | null | undefined): number {
  return Math.max(0, amountCents - Math.round((amountCents * (percent ?? 0)) / 100));
}

/** Lista canônica (centavos, paginação page/limit) → formato legado `{ withdrawals, meta }` (R$, currentPage/itemsPerPage). */
export function mapCanonicalWithdrawals(
  page: SimintpayWithdrawalPage,
  user: { id: string; name?: string | null; email?: string | null },
) {
  return {
    withdrawals: page.data.map((w) => ({
      id: w.id,
      userId: user.id,
      // Histórico: bruto debitado, taxa e líquido efetivamente sacado (amount = líquido, como no legado).
      grossAmount: reais(w.grossAmountCents),
      fee: reais(w.feeCents),
      amount: reais(w.amountCents),
      netAmount: reais(w.amountCents),
      status: w.status,
      pixKey: w.pixKey,
      rejectionReason: w.rejectionReason ?? null,
      createdAt: w.createdAt,
      user: { name: user.name ?? '-', email: user.email ?? '-' },
    })),
    meta: {
      currentPage: page.meta.page,
      itemsPerPage: page.meta.limit,
      totalItems: page.meta.total,
      totalPages: page.meta.totalPages,
    },
  };
}

/** Cotação de saque em R$: bruto informado, taxa subtraída e líquido a receber. */
export function mapWithdrawalQuote(quote: SimintpayQuote, fees: SimintpayMerchantFees) {
  return {
    grossAmount: reais(quote.grossAmountCents),
    fee: reais(quote.feeCents),
    netAmount: reais(quote.netAmountCents),
    minimumWithdrawalAmount: reais(fees.withdrawal.minimumCents),
  };
}

/** Mesma fórmula do quote canônico: taxa = fixa + bruto × percentual, arredondada ao centavo. */
export function withdrawalFeeCents(grossCents: number, policy: { fixedCents: number; rate: number }): number {
  return Math.round(policy.fixedCents + grossCents * policy.rate);
}

export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{1,120}$/;

/**
 * Chave de idempotência do saque.
 * - Se o cliente enviar `idempotencyKey` (válida), ela é usada (preferido: dois cliques = mesma chave).
 * - Senão, é derivada de usuário + valor bruto + chave PIX + bucket de 1 minuto: reenvios idênticos
 *   dentro do mesmo minuto (duplo clique, retry de rede) colapsam em um único saque no SimIntPay;
 *   um mesmo saque repetido propositalmente depois do bucket gera nova chave.
 */
export function withdrawalIdempotencyKey(input: {
  userId: string;
  grossCents: number;
  pixKey: string;
  clientKey?: string;
  now?: number;
}): string {
  if (input.clientKey !== undefined && input.clientKey !== '') {
    if (!IDEMPOTENCY_KEY_PATTERN.test(input.clientKey)) throw new Error('idempotencyKey inválida');
    return input.clientKey; // o SimIntPay já escopa a chave por comerciante
  }
  const bucket = Math.floor((input.now ?? Date.now()) / 60_000);
  const digest = createHash('sha256')
    .update(`${input.userId}|${input.grossCents}|${input.pixKey.trim()}|${bucket}`)
    .digest('hex')
    .slice(0, 40);
  return `ebook-${digest}`;
}
