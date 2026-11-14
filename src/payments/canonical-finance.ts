import { createHash } from 'node:crypto';
import type { SimintpayMerchantSummary, SimintpayWithdrawalPage } from 'src/common/simintpay-platform';

/** Rotas financeiras canônicas só valem com EBOOK_CANONICAL_FINANCE=true (padrão: desligado → caminho legado). */
export function isCanonicalFinanceEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.EBOOK_CANONICAL_FINANCE ?? '').trim().toLowerCase() === 'true';
}

const reais = (cents: unknown): number => Number((Number(cents ?? 0) / 100).toFixed(2));

export type LegacySummaryFields = {
  minimumWithdrawalAmount?: number;
  pixFeePercent?: number;
  transactionFeeBrl?: number;
  withdrawalFeeBrl?: number;
} | null;

/**
 * Converte o summary canônico (centavos) para o formato legado esperado pelo frontend (R$).
 *
 * TODO(plano: "taxas por modalidade"): o contrato canônico ainda não expõe saque mínimo, taxa por transação
 * (fixa) nem o percentual por modalidade (PIX/cartão). Enquanto isso, esses campos vêm do summary legado
 * (`legacy`); quando existirem no canônico, remover a dependência do legado aqui.
 * Obs.: `feePolicy` canônico descreve a taxa de SAQUE (fixa + percentual), não a taxa de venda.
 */
export function mapCanonicalSummary(canonical: SimintpayMerchantSummary, legacy: LegacySummaryFields) {
  const withdrawalFeeBrl = canonical.feePolicy ? reais(canonical.feePolicy.fixedCents) : legacy?.withdrawalFeeBrl;
  return {
    availableBalance: reais(canonical.availableBalanceCents),
    pendingWithdraws: reais(canonical.pendingPlatformWithdrawalsCents),
    lockedBalance: reais(canonical.lockedBalanceCents),
    minimumWithdrawalAmount: legacy?.minimumWithdrawalAmount,
    withdrawalFeeBrl,
    withdrawalFeePercent: canonical.feePolicy ? Number(canonical.feePolicy.rate) : undefined,
    pixFeePercent: legacy?.pixFeePercent,
    transactionFeeBrl: legacy?.transactionFeeBrl,
    accountExists: true,
  };
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
      amount: reais(w.amountCents),
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

/** Mesma fórmula do quote canônico: taxa = fixa + bruto × percentual, arredondada ao centavo. */
export function withdrawalFeeCents(grossCents: number, policy: { fixedCents: number; rate: number }): number {
  return Math.round(policy.fixedCents + grossCents * policy.rate);
}

/**
 * O frontend/legado informa o valor LÍQUIDO que o vendedor quer receber (a taxa é somada por cima);
 * o canônico recebe o BRUTO debitado. Retorna o menor bruto cujo líquido é >= ao desejado.
 */
export function grossForNet(netCents: number, policy: { fixedCents: number; rate: number }): number {
  if (!(policy.rate >= 0 && policy.rate < 1)) throw new Error('Política de taxa de saque inválida');
  let gross = Math.max(1, Math.ceil((netCents + policy.fixedCents) / (1 - policy.rate)));
  while (gross - withdrawalFeeCents(gross, policy) < netCents) gross += 1;
  while (gross > 1 && gross - 1 - withdrawalFeeCents(gross - 1, policy) >= netCents) gross -= 1;
  return gross;
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
