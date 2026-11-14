/**
 * Provisiona os vendedores locais como comerciantes canônicos do SimIntPay (PUT /platforms/EBOOK/merchants/:doc).
 *
 *   bun scripts/provision-merchants.ts                 # DRY-RUN (padrão): não chama a API, só lista o que faria
 *   bun scripts/provision-merchants.ts --apply         # chama a API (exige SIMINTPAY_URL + SIMINTPAY_PLATFORM_TOKEN)
 *   opções: --roles=ADMIN,USER  --delay-ms=250  --limit=N
 *
 * Idempotente: com --apply, um GET de summary (finance:read) detecta comerciantes já provisionados e pula o PUT
 * (que sobrescreveria o nome do usuário SimIntPay com o legalName local). Nunca escreve no banco local nem imprime tokens.
 * Sai com código != 0 se houver erros. Escopos do token: merchants:manage (PUT) e finance:read (GET).
 */
import { merchantSummary, provisionMerchant, isMerchantNotAssociated, isMerchantWithoutAccount, SimintpayPlatformError } from '../src/common/simintpay-platform';
import { isValidCnpj, isValidCpf, normalizeCpf } from '../src/common/utils/cpf.util';

export type SellerRow = { id: string; name: string | null; email: string; role: string; cpf: string | null; cnpj: string | null };
export type Outcome = 'provisioned' | 'would-provision' | 'already-ok' | 'no-account' | 'invalid-document' | 'error';
export type Deps = {
  summary: (document: string) => Promise<unknown>;
  provision: (document: string, legalName: string) => Promise<unknown>;
  sleep: (ms: number) => Promise<void>;
  log: (line: string) => void;
};

export const maskDocument = (document: string): string =>
  document.length < 6 ? '***' : `${document.slice(0, 3)}${'*'.repeat(document.length - 5)}${document.slice(-2)}`;

/** CNPJ válido tem precedência; documento inválido (ou ausente) → null. */
export function documentOf(user: Pick<SellerRow, 'cpf' | 'cnpj'>): string | null {
  const cnpj = normalizeCpf(user.cnpj);
  if (isValidCnpj(cnpj)) return cnpj;
  const cpf = normalizeCpf(user.cpf);
  return isValidCpf(cpf) ? cpf : null;
}

export async function provisionAll(users: SellerRow[], options: { apply: boolean; delayMs: number }, deps: Deps) {
  const counts: Record<Outcome, number> = { provisioned: 0, 'would-provision': 0, 'already-ok': 0, 'no-account': 0, 'invalid-document': 0, error: 0 };
  const rows: Array<{ user: string; role: string; document: string; outcome: Outcome; detail: string }> = [];
  let calledApi = false;
  for (const user of users) {
    const document = documentOf(user);
    let outcome: Outcome;
    let detail = '';
    if (!document || !user.name?.trim()) {
      outcome = 'invalid-document';
      detail = document ? 'sem nome (legalName)' : 'CPF/CNPJ ausente ou inválido';
    } else if (!options.apply) {
      outcome = 'would-provision';
    } else {
      if (calledApi) await deps.sleep(options.delayMs);
      calledApi = true;
      try {
        let exists = true;
        try {
          await deps.summary(document);
        } catch (error) {
          if (!isMerchantNotAssociated(error)) throw error;
          exists = false;
        }
        if (exists) outcome = 'already-ok';
        else {
          await deps.provision(document, user.name);
          outcome = 'provisioned';
        }
      } catch (error) {
        if (isMerchantWithoutAccount(error)) {
          outcome = 'no-account';
          detail = 'sem conta SimIntPay ativa com este documento';
        } else {
          outcome = 'error';
          detail = error instanceof SimintpayPlatformError ? `HTTP ${error.status}` : 'falha de rede';
        }
      }
    }
    counts[outcome]++;
    rows.push({ user: user.email, role: user.role, document: document ? maskDocument(document) : maskDocument(normalizeCpf(user.cnpj ?? user.cpf)), outcome, detail });
  }
  deps.log(['usuário'.padEnd(36), 'papel'.padEnd(6), 'documento'.padEnd(16), 'resultado'.padEnd(17), 'detalhe'].join(' '));
  for (const row of rows) deps.log([row.user.padEnd(36), row.role.padEnd(6), row.document.padEnd(16), row.outcome.padEnd(17), row.detail].join(' '));
  deps.log(
    `\nResumo (${options.apply ? 'APPLY' : 'DRY-RUN'}): total=${users.length} provisioned=${counts.provisioned} would-provision=${counts['would-provision']} ` +
      `already-ok=${counts['already-ok']} no-account=${counts['no-account']} invalid-document=${counts['invalid-document']} errors=${counts.error}`,
  );
  return { counts, rows, exitCode: counts.error > 0 ? 1 : 0 };
}

export function parseArgs(argv: string[]) {
  const flag = (name: string) => argv.find((arg) => arg.startsWith(`--${name}=`))?.split('=')[1];
  return {
    apply: argv.includes('--apply'),
    roles: (flag('roles') ?? 'ADMIN,USER').split(',').map((r) => r.trim().toUpperCase()).filter(Boolean),
    delayMs: Number(flag('delay-ms') ?? 250),
    limit: flag('limit') ? Number(flag('limit')) : undefined,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.apply && (!process.env.SIMINTPAY_PLATFORM_TOKEN || !(process.env.SIMINTPAY_URL || process.env.API_MACHINE_URL))) {
    console.error('--apply exige SIMINTPAY_URL (ou API_MACHINE_URL) e SIMINTPAY_PLATFORM_TOKEN.');
    process.exit(2);
  }
  const { PrismaClient } = await import('../prisma/generated/prisma');
  const { Pool } = await import('pg');
  const { PrismaPg } = await import('@prisma/adapter-pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  try {
    // Somente leitura. ADMIN/USER (vendedores e afiliados) + qualquer um que seja dono de livros ou tenha comissões de afiliado.
    const users = (await prisma.user.findMany({
      where: {
        isActive: true,
        AND: [
          { OR: [{ cpf: { not: null } }, { cnpj: { not: null } }] },
          // Vendedores E afiliados: papéis configurados, ou quem é dono de livros / recebeu comissão (qualquer papel).
          { OR: [{ role: { in: args.roles as any } }, { booksCreated: { some: {} } }, { affiliateCommissions: { some: {} } }] },
        ],
      },
      select: { id: true, name: true, email: true, role: true, cpf: true, cnpj: true },
      orderBy: { createdAt: 'asc' },
      take: args.limit,
    })) as SellerRow[];
    console.log(`${args.apply ? 'APPLY' : 'DRY-RUN (use --apply para chamar a API)'} — ${users.length} usuário(s), papéis: ${args.roles.join(',')}`);
    const result = await provisionAll(users, args, {
      summary: merchantSummary,
      provision: provisionMerchant,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      log: console.log,
    });
    process.exitCode = result.exitCode;
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Falha no script:', error instanceof Error ? error.message : 'erro desconhecido');
    process.exit(1);
  });
}
