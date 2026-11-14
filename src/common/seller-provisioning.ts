import { isValidCnpj, isValidCpf, normalizeCpf } from './utils/cpf.util';
import { provisionMerchantSafe } from './simintpay-platform';

/**
 * Papéis provisionados automaticamente: ADMIN (vendedores) e USER (afiliados, comissão na carteira por CPF).
 * CUSTOMER só é provisionado pelo script quando é dono de livros ou tem comissões de afiliado.
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
 * Só tem efeito se SIMINTPAY_URL/SIMINTPAY_PLATFORM_TOKEN estiverem configurados. O SimIntPay cria a conta do
 * vendedor/afiliado quando nenhuma possui o documento (o `email` é obrigatório para isso); a senha é definida pelo
 * titular via POST /auth/forgot-password. Nunca usa adoptByEmail (o e-mail do cadastro não é verificado).
 */
export function provisionSellerMerchantInBackground(user: {
  role?: string | null;
  name?: string | null;
  email?: string | null;
  cpf?: string | null;
  cnpj?: string | null;
}): void {
  if (!SELLER_ROLES.includes(String(user.role) as (typeof SELLER_ROLES)[number])) return;
  const document = sellerDocument(user);
  if (!document) return;
  void provisionMerchantSafe(document, user.name, user.email).catch(() => undefined);
}

/** Variante aguardável para a rede de segurança do prepareSettlement (nunca lança). */
export async function provisionSellerMerchant(user: {
  name?: string | null;
  email?: string | null;
  cpf?: string | null;
  cnpj?: string | null;
}): Promise<void> {
  const document = sellerDocument(user);
  if (!document) return;
  await provisionMerchantSafe(document, user.name, user.email).catch(() => undefined);
}
