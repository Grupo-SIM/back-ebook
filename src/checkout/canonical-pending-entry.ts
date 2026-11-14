import {
  isCanonicalFinanceEnabled,
  isSimintpayPlatformConfigured,
  merchantEntry,
  merchantFees,
  platformFinanceConfig,
  SimintpayPlatformError,
} from 'src/common/simintpay-platform';
import { entryNetCents, entryPaymentMethod, entryPercent } from 'src/payments/canonical-finance';

/**
 * Venda pendente pela rota canônica (POST finance/entries, kind=pending, escopo ledger:write).
 * Retorna true se o lançamento foi aceito (idempotente por referenceId); false = usar o caminho legado
 * (flag desligada, sem documento do dono, vendedor não provisionado ou erro): o domPaymentId é o mesmo nos dois, então é seguro.
 * O líquido (netAmountCents) é calculado aqui a partir de finance/fees (taxa de processamento da modalidade).
 */
export async function tryCanonicalPendingEntry(params: {
  orderNumber: string;
  amount: number;
  ownerDocument: string | null;
  ownerName?: string | null;
  paymentMethod?: string;
  buyer?: { name?: string; email?: string; cpf?: string };
}): Promise<boolean> {
  const document = String(params.ownerDocument ?? '').replace(/\D/g, '');
  if (!isCanonicalFinanceEnabled() || !isSimintpayPlatformConfigured()) return false;
  if (document.length !== 11 && document.length !== 14) return false;
  try {
    const method = entryPaymentMethod(params.paymentMethod);
    const amountCents = Math.round(params.amount * 100);
    const fees = await merchantFees(document);
    const tag = `[${document.length === 14 ? 'CNPJ' : 'CPF'}_DONO:${document}]`;
    const nameTag = params.ownerName ? ` [NOME_DONO:${params.ownerName}]` : '';
    await merchantEntry(document, {
      referenceId: params.orderNumber,
      kind: 'pending',
      amountCents,
      netAmountCents: entryNetCents(amountCents, entryPercent(fees, method)),
      paymentMethod: method,
      installments: 1,
      description: `${params.orderNumber} ${tag}${nameTag}`,
      customerName: params.buyer?.name,
      customerEmail: params.buyer?.email,
      customerDocument: params.buyer?.cpf ? String(params.buyer.cpf).replace(/\D/g, '') : undefined,
    });
    return true;
  } catch (error) {
    const status = error instanceof SimintpayPlatformError ? error.status : 'rede';
    console.warn(`[simintpay] lançamento pendente canônico falhou (${status}); usando caminho legado`);
    return false;
  }
}

let cached: { liquidez: number | null; taxaFixa: number | null; at: number } | null = null;

/** Config da plataforma (fallback de líquido no checkout): liquidityRate e transactionFeeCents/100. null = indisponível. */
export async function canonicalPlatformFees(): Promise<{ liquidez: number | null; taxaFixa: number | null } | null> {
  if (!isCanonicalFinanceEnabled() || !isSimintpayPlatformConfigured()) return null;
  if (cached && Date.now() - cached.at < 30_000) return cached;
  try {
    const config = await platformFinanceConfig();
    cached = {
      liquidez: Number.isFinite(config.liquidityRate) ? Number(config.liquidityRate) : null,
      taxaFixa: Number.isFinite(config.transactionFeeCents) ? Number(config.transactionFeeCents) / 100 : null,
      at: Date.now(),
    };
    return cached;
  } catch {
    return null;
  }
}
