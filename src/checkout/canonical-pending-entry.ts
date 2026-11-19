import {
  isSimintpayPlatformConfigured,
  merchantEntry,
  platformFinanceConfig,
  SimintpayPlatformError,
} from 'src/common/simintpay-platform';
import { entryPaymentMethod } from 'src/payments/canonical-finance';

export type PendingEntryParams = {
  orderNumber: string;
  amount: number;
  ownerDocument: string | null;
  ownerName?: string | null;
  paymentMethod?: string;
  buyer?: { name?: string; email?: string; cpf?: string };
};

/** A entrada canônica se aplica quando o SimIntPay está configurado e o dono tem CPF/CNPJ. */
export function canonicalPendingEntryApplies(ownerDocument: string | null | undefined): boolean {
  const document = String(ownerDocument ?? '').replace(/\D/g, '');
  return isSimintpayPlatformConfigured() && (document.length === 11 || document.length === 14);
}

/**
 * Venda pendente pela rota canônica (POST finance/entries, kind=pending, escopo ledger:write).
 * Retorna true se o lançamento foi aceito (idempotente por referenceId); false = não aplicável ou falhou (o chamador
 * decide: legado com a flag desligada; com a flag ligada, fila durável `ebook_pending_entry_deliveries`).
 * `amountCents` = valor do dono antes dos juros; o líquido é SEMPRE calculado pelo SimIntPay (não enviamos
 * netAmountCents). Limitação: o pedido nasce antes de o comprador escolher modalidade/parcelas no checkout (o Order não guarda
 * parcelas nem juros), então o lançamento pendente sai como PIX/1x; quando o webhook DOM conclui a venda, o SimIntPay
 * recota o líquido com as parcelas e o total pagos de verdade (juros do cartão) sobre esse valor do dono.
 */
export async function tryCanonicalPendingEntry(params: PendingEntryParams): Promise<boolean> {
  const document = String(params.ownerDocument ?? '').replace(/\D/g, '');
  if (!canonicalPendingEntryApplies(document)) return false;
  try {
    const method = entryPaymentMethod(params.paymentMethod);
    const amountCents = Math.round(params.amount * 100);
    const tag = `[${document.length === 14 ? 'CNPJ' : 'CPF'}_DONO:${document}]`;
    const nameTag = params.ownerName ? ` [NOME_DONO:${params.ownerName}]` : '';
    await merchantEntry(document, {
      referenceId: params.orderNumber,
      kind: 'pending',
      amountCents,
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
    console.warn(`[simintpay] lançamento pendente canônico falhou (${status})`);
    return false;
  }
}

let cached: { liquidez: number | null; taxaFixa: number | null; at: number } | null = null;

/** Config da plataforma (fallback de líquido no checkout): taxa efetiva/alvo ativa e transactionFeeCents/100. null = indisponível. */
export async function canonicalPlatformFees(): Promise<{ liquidez: number | null; taxaFixa: number | null } | null> {
  if (!isSimintpayPlatformConfigured()) return null;
  if (cached && Date.now() - cached.at < 30_000) return cached;
  try {
    const config = await platformFinanceConfig();
    const ratePpm =
      typeof config.pixProcessingRatePpm === 'number' && Number.isFinite(config.pixProcessingRatePpm)
        ? config.pixProcessingRatePpm
        : typeof config.effectiveTargetFeePpm === 'number' && Number.isFinite(config.effectiveTargetFeePpm)
          ? config.effectiveTargetFeePpm
          : null;
    const liquidez =
      ratePpm !== null
        ? Number((1 - ratePpm / 1_000_000).toFixed(6))
        : Number.isFinite(config.liquidityRate)
          ? Number(config.liquidityRate)
          : null;
    cached = {
      liquidez,
      taxaFixa: Number.isFinite(config.transactionFeeCents) ? Number(config.transactionFeeCents) / 100 : null,
      at: Date.now(),
    };
    return cached;
  } catch {
    return null;
  }
}
