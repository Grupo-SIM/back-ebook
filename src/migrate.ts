const { PrismaClient } = require('../prisma/generated/prisma');

async function migrateData() {
  const sourcePrisma = new PrismaClient({
    datasources: {
      db: { url: "postgresql://postgres:pUXSu1qNwOgl4It@144.126.147.163:5432/back-ebook", }
    },
  });

  const targetPrisma = new PrismaClient({
    datasources: {
      db: { url: "postgresql://postgres:pUXSu1qNwOgl4It@144.126.147.163:5432/back-ebook", }
    },
  });

  try {
    // 1. Migrar Usuários
    console.log('Iniciando migração de usuários...');
    const users = await sourcePrisma.user.findMany({
      include: {
        Image: true,
      },
    });
    console.log(`Encontrados ${users.length} usuários para migrar`);

    for (const user of users) {
      const { Image, ...userData } = user;
      try {
        const existingUser = await targetPrisma.user.findUnique({
          where: { id: user.id },
        });

        if (existingUser) {
          console.log(`Usuário ${user.id} já existe - pulando...`);
          continue;
        }

        await targetPrisma.user.create({
          data: userData,
        });
        console.log(`Usuário ${user.id} migrado com sucesso`);
      } catch (error) {
        console.error(`Erro ao migrar usuário ${user.id}:`, error);
      }
    }

    // 2. Migrar Admins
    console.log('\nIniciando migração de admins...');
    const admins = await sourcePrisma.admin.findMany();
    console.log(`Encontrados ${admins.length} admins para migrar`);

    for (const admin of admins) {
      try {
        const existingAdmin = await targetPrisma.admin.findUnique({
          where: { id: admin.id },
        });

        if (existingAdmin) {
          console.log(`Admin ${admin.id} já existe - pulando...`);
          continue;
        }

        await targetPrisma.admin.create({
          data: admin,
        });
        console.log(`Admin ${admin.id} migrado com sucesso`);
      } catch (error) {
        console.error(`Erro ao migrar admin ${admin.id}:`, error);
      }
    }

    // 3. Migrar Imagens
    console.log('\nIniciando migração de imagens...');
    const images = await sourcePrisma.image.findMany({
      include: {
        users: true,
      },
    });
    console.log(`Encontradas ${images.length} imagens para migrar`);

    for (const image of images) {
      try {
        const { users, ...imageData } = image;
        const existingImage = await targetPrisma.image.findUnique({
          where: { id: image.id },
        });

        if (existingImage) {
          console.log(`Imagem ${image.id} já existe - pulando...`);
          continue;
        }

        await targetPrisma.image.create({
          data: {
            ...imageData,
            users: {
              connect: users.map(user => ({ id: user.id }))
            },
          },
        });
        console.log(`Imagem ${image.id} migrada com sucesso`);
      } catch (error) {
        console.error(`Erro ao migrar imagem ${image.id}:`, error);
      }
    }

    console.log('\nMigração concluída com sucesso!');

  } catch (error) {
    console.error('Erro durante a migração:', error);
    throw error;
  } finally {
    await sourcePrisma.$disconnect();
    await targetPrisma.$disconnect();
  }
}

// Executar a migração
migrateData()
  .catch((error) => {
    console.error('Erro fatal durante a migração:', error);
    process.exit(1);
  });