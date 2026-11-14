import { isValidCnpj, isValidCpf, normalizeCpf } from './utils/cpf.util';
import { provisionMerchantSafe } from './simintpay-platform';

/**
 * Papéis que recebem repasse no SimIntPay: ADMIN (dono dos livros, único papel que cria livros e acessa /payments)
 * e USER (afiliados, que recebem comissão na carteira por CPF). CUSTOMER é comprador/gestor de contas e não recebe.
 */
export const SELLER_ROLES = ['ADMIN', 'USER'] as const;

/** CNPJ válido tem precedência sobre CPF (mesma regra de PaymentsController.getCpfFromUser). */
export function sellerDocument(user: { cpf?: string | null; cnpj?: string | null }): string | null {
  const cnpj = normalizeCpf(user.cnpj);
  if (isValidCnpj(cnpj)) return cnpj;
  const cpf = normalizeCpf(user.cpf);
  return isValidCpf(cpf) ? cpf : null;
}

/**
 * Provisionamento best-effort (nunca lança, não bloqueia o fluxo chamador, sem segredos nos logs).
 * Só tem efeito se SIMINTPAY_URL/SIMINTPAY_PLATFORM_TOKEN estiverem configurados. Se o usuário SimIntPay ainda
 * não possui o documento, o SimIntPay responde 400 e o resultado é 'no-account' — rode o script
 * provision:merchants depois que o documento estiver na conta SimIntPay.
 */
export function provisionSellerMerchantInBackground(user: {
  role?: string | null;
  name?: string | null;
  cpf?: string | null;
  cnpj?: string | null;
}): void {
  if (!SELLER_ROLES.includes(String(user.role) as (typeof SELLER_ROLES)[number])) return;
  const document = sellerDocument(user);
  if (!document) return;
  void provisionMerchantSafe(document, user.name).catch(() => undefined);
}
