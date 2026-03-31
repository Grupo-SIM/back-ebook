import * as bcrypt from 'bcrypt';
import { PrismaClient, Role } from '../prisma/generated/prisma';

const prisma = new PrismaClient();

function normalizeCpf(raw: string): string {
  return String(raw ?? '').replace(/\D/g, '');
}

async function upsertDefaultEbookAdmin() {
  const email = String(process.env.SEED_EBOOK_ADMIN_EMAIL || 'admin@ebooksim.com').toLowerCase().trim();
  const name = process.env.SEED_EBOOK_ADMIN_NAME || 'Admin Ebook';
  const plainPassword = process.env.SEED_EBOOK_ADMIN_PASSWORD || 'Admin@123';
  const cpf = normalizeCpf(process.env.SEED_EBOOK_ADMIN_CPF || '12345678909');

  if (cpf.length !== 11) {
    throw new Error('SEED_EBOOK_ADMIN_CPF inválido. Informe 11 dígitos.');
  }

  const salt = bcrypt.genSaltSync(9);
  const password = bcrypt.hashSync(plainPassword, salt);

  const existingByEmail = await prisma.user.findFirst({
    where: { email, role: Role.ADMIN },
  });

  if (existingByEmail) {
    await prisma.user.update({
      where: { id: existingByEmail.id },
      data: {
        name,
        cpf,
        password,
        isActive: true,
      },
    });
    await prisma.admin.upsert({
      where: { userId: existingByEmail.id },
      create: { userId: existingByEmail.id },
      update: {},
    });
    return;
  }

  const user = await prisma.user.create({
    data: {
      email,
      name,
      cpf,
      password,
      role: Role.ADMIN,
      isActive: true,
    },
  });

  await prisma.admin.upsert({
    where: { userId: user.id },
    create: { userId: user.id },
    update: {},
  });
}

async function main() {
  await upsertDefaultEbookAdmin();
  console.log('Seed concluido: conta padrao do ebook validada.');
}

main()
  .catch((err) => {
    console.error('Erro ao executar seed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
