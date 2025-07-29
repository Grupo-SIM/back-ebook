import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { GenericService } from 'src/generic.service';
import { AdminResponseDto, AdminRevenueDto, AdminRevenueDetailedDto, AdminRevenuePeriodDto } from './admin.dto';
import dayjs from 'dayjs';
import isBetween from 'dayjs/plugin/isBetween';
import { PrismaService } from 'prisma/prisma.service';

dayjs.extend(isBetween);

@Injectable()
export class AdminService extends GenericService {
  async getAllAdmins(): Promise<AdminResponseDto[]> {
    try {
      return await this.getAll0('admin');
    } catch (error) {
      const items0 = await this.prisma.admin.findMany({
        include: {
          adminUser: true,
        },
      });

      return items0.map((e) => ({
        ...e,
        name: e.adminUser?.name,
        email: e.adminUser.email,
        userId: e.adminUser.id,
        role: e.adminUser.role,
        createdAt: e.createdAt.toISOString(),
        updatedAt: e.updatedAt.toISOString(),
      }));
    }
  }

  async getAllAdminNames(): Promise<string[]> {
    const admins = await this.prisma.admin.findMany({
      select: {
        adminUser: {
          select: {
            name: true
          }
        }
      },
    });

    return admins
      .map(admin => admin.adminUser.name)
      .filter(name => name !== null && name !== undefined);
  }
  async getAll0(modelName: string): Promise<any[]> {
    const cacheKey = `all_${modelName}s`;
    const cachedData = await this.redisService.get(cacheKey);

    if (cachedData) {
      return JSON.parse(cachedData);
    }

    const items0 = await this.prisma.admin.findMany({
      include: {
        adminUser: true,
      },
    });

    const items = items0.map((e) => ({
      ...e,
      name: e.adminUser?.name,
      email: e.adminUser.email,
      userId: e.adminUser.id,
      createdAt: dayjs(e.createdAt).format('DD/MM/YYYY'),
    }));

    await this.redisService.set(
      cacheKey,
      JSON.stringify(items),
      this.CACHE_TTL,
    );
    return items;
  }

  async getAdminById(id: string): Promise<AdminResponseDto> {
    return this.getById0('admin', id);
  }

  async getById0(modelName: string, id: string): Promise<any | null> {
    const cacheKey = `${modelName}:${id}`;
    const cachedData = await this.redisService.get(cacheKey);

    if (cachedData) {
      return JSON.parse(cachedData);
    }

    const item0 = await this.prisma.admin.findUnique({
      where: { id },
      include: {
        adminUser: true,
      },
    });

    if (!item0) {
      return null;
    }

    const item = {
      ...item0,
      name: item0.adminUser.name,
      email: item0.adminUser.email,
      role: item0.adminUser.role,
    };

    await this.redisService.set(
      cacheKey,
      JSON.stringify(item),
      this.CACHE_TTL,
    );

    return item;
  }

  async createAdmin(data: { userId: string }): Promise<AdminResponseDto> {
    return this.create('admin', data);
  }

  async updateAdmin(id: string, data: { name?: string; email?: string }): Promise<any> {
    const admin = await this.prisma.admin.findUnique({
      where: { id },
      include: { adminUser: true }
    });

    if (!admin) {
      throw new NotFoundException('Admin not found');
    }

    const updatedUser = await this.prisma.user.update({
      where: { id: admin.userId },
      data: {
        name: data.name,
        email: data.email,
      },
    });

    await this.invalidateCache(id);
    return { ...admin, user: updatedUser };
  }

  async deleteAdmin(id: string): Promise<AdminResponseDto> {
    const admin = await this.delete('admin', id);
    await this.invalidateCache(id);
    return admin;
  }

  private async invalidateCache(id: string) {
    await this.redisService.del(`admin:${id}`);
    await this.redisService.del('all_admins');
  }

  async getAdminByUserId(userId: string): Promise<AdminResponseDto | null | any> {
    const cacheKey = `admin:user:${userId}`;
    const cachedData = await this.redisService.get(cacheKey);

    if (cachedData) {
      return JSON.parse(cachedData);
    }

    const admin = await this.prisma.admin.findUnique({
      where: { userId },
      include: { adminUser: true },
    });

    if (admin) {
      await this.redisService.set(cacheKey, JSON.stringify(admin), this.CACHE_TTL);
    }

    return admin;
  }

  async getRecentActivities(adminId: string, page: number = 1, limit: number = 10) {
    const skip = (page - 1) * limit;
    // Buscar logs imutáveis da tabela ActivityLog
    const [logs, total] = await Promise.all([
      this.prisma['activityLog'].findMany({
        where: { adminId },
        orderBy: { timestamp: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma['activityLog'].count({ where: { adminId } })
    ]);
    const totalPages = Math.ceil(total / limit);
    return {
      data: logs.map(log => ({
        id: log.id,
        type: log.type,
        message: log.message,
        timestamp: log.timestamp,
        bookId: log.bookId,
        bookTitle: log.bookTitle,
      })),
      page,
      limit,
      total,
      totalPages
    };
  }

  async getAdminRevenue(adminId: string): Promise<AdminRevenueDto> {
    console.log('🔥 AdminService.getAdminRevenue - Iniciado para adminId:', adminId);

    // Buscar informações do admin
    try {
      const admin = await this.prisma.admin.findUnique({
        where: { id: adminId },
        include: { adminUser: true }
      });

      console.log('🔥 Admin encontrado:', admin ? 'SIM' : 'NÃO');
      console.log('🔥 Dados do admin:', admin ? {
        id: admin.id,
        userId: admin.userId,
        adminUser: admin.adminUser ? {
          id: admin.adminUser.id,
          name: admin.adminUser.name,
          email: admin.adminUser.email
        } : null
      } : 'NENHUM');

      if (!admin) {
        console.log('❌ Admin não encontrado - lançando NotFoundException');
        throw new NotFoundException('Admin not found');
      }

      console.log('✅ Admin encontrado com sucesso, buscando livros...');

      // Buscar todos os livros criados pelo admin
      const adminBooks = await this.prisma.book.findMany({
        where: { createdById: admin.userId },
        select: { id: true, title: true, price: true }
      });

      console.log('🔥 Livros encontrados:', adminBooks.length);
      console.log('🔥 Livros:', adminBooks.map(book => ({ id: book.id, title: book.title })));

      if (adminBooks.length === 0) {
        console.log('⚠️ Nenhum livro encontrado - retornando receita zero');
        return {
          adminId,
          adminName: admin.adminUser.name || 'Admin',
          totalRevenue: 0,
          totalSales: 0,
          totalBooksSold: 0,
          currentMonthRevenue: 0,
          currentMonthSales: 0,
          currentMonthBooksSold: 0,
          lastSaleDate: null,
          bestSellingBook: 'Nenhum',
          bestSellingBookQuantity: 0,
          bestSellingBookPrice: 0
        };
      }

      const bookIds = adminBooks.map(book => book.id);
      const currentMonth = dayjs().startOf('month');
      const currentMonthEnd = dayjs().endOf('month');

      console.log('🔥 Buscando vendas para os livros...');

      // Buscar vendas dos livros do admin
      const sales = await this.prisma.orderItem.findMany({
        where: {
          bookId: { in: bookIds },
          order: {
            status: 'paid'
          }
        },
        include: {
          book: true,
          order: true
        }
      });

      console.log('🔥 Vendas encontradas:', sales.length);

      // Calcular estatísticas gerais
      const totalRevenue = sales.reduce((sum, sale) => sum + (sale.totalPrice || 0), 0);
      const totalSales = sales.length;
      const totalBooksSold = sales.reduce((sum, sale) => sum + sale.quantity, 0);

      // Calcular estatísticas do mês atual
      const currentMonthSales = sales.filter(sale =>
        dayjs(sale.order.updatedAt).isBetween(currentMonth, currentMonthEnd, null, '[]')
      );
      const currentMonthRevenue = currentMonthSales.reduce((sum, sale) => sum + (sale.totalPrice || 0), 0);
      const currentMonthBooksSold = currentMonthSales.reduce((sum, sale) => sum + sale.quantity, 0);

      // Encontrar a última venda
      const lastSale = sales.length > 0 ?
        sales.reduce((latest, sale) =>
          dayjs(sale.order.updatedAt).isAfter(dayjs(latest.order.updatedAt)) ? sale : latest
        ) : null;

      // Encontrar o livro mais vendido
      const bookSalesCount = {};
      sales.forEach(sale => {
        const bookTitle = sale.book.title;
        if (!bookSalesCount[bookTitle]) {
          bookSalesCount[bookTitle] = {
            quantity: 0,
            price: sale.book.price
          };
        }
        bookSalesCount[bookTitle].quantity += sale.quantity;
      });

      const bestSellingBook = Object.keys(bookSalesCount).length > 0 ?
        Object.keys(bookSalesCount).reduce((best, book) =>
          bookSalesCount[book].quantity > bookSalesCount[best].quantity ? book : best
        ) : 'Nenhum';

      const result = {
        adminId,
        adminName: admin.adminUser.name || 'Admin',
        totalRevenue: Number(totalRevenue.toFixed(2)),
        totalSales,
        totalBooksSold,
        currentMonthRevenue: Number(currentMonthRevenue.toFixed(2)),
        currentMonthSales: currentMonthSales.length,
        currentMonthBooksSold,
        lastSaleDate: lastSale ? lastSale.order.updatedAt.toISOString() : null,
        bestSellingBook,
        bestSellingBookQuantity: bestSellingBook !== 'Nenhum' ? bookSalesCount[bestSellingBook].quantity : 0,
        bestSellingBookPrice: bestSellingBook !== 'Nenhum' ? bookSalesCount[bestSellingBook].price : 0
      };

      console.log('✅ Receita calculada com sucesso:', result);
      return result;

    } catch (error) {
      console.error('❌ Erro em getAdminRevenue:', error);
      throw error;
    }
  }

  async getAdminRevenueDetailed(adminId: string): Promise<AdminRevenueDetailedDto> {
    // Buscar receita básica
    const basicRevenue = await this.getAdminRevenue(adminId);

    // Buscar livros do admin
    const admin = await this.prisma.admin.findUnique({
      where: { id: adminId },
      include: { adminUser: true }
    });

    if (!admin) {
      throw new NotFoundException('Admin not found');
    }

    const adminBooks = await this.prisma.book.findMany({
      where: { createdById: admin.userId },
      select: { id: true }
    });

    if (adminBooks.length === 0) {
      return {
        ...basicRevenue,
        monthlyRevenue: [],
        averageRevenuePerSale: 0,
        averageRevenuePerBook: 0
      };
    }

    const bookIds = adminBooks.map(book => book.id);

    // Buscar vendas dos últimos 12 meses
    const twelveMonthsAgo = dayjs().subtract(12, 'month').startOf('month');

    const sales = await this.prisma.orderItem.findMany({
      where: {
        bookId: { in: bookIds },
        order: {
          status: 'paid',
          updatedAt: {
            gte: twelveMonthsAgo.toDate()
          }
        }
      },
      include: {
        order: true
      }
    });

    // Calcular receita mensal
    const monthlyRevenue: AdminRevenuePeriodDto[] = [];
    for (let i = 11; i >= 0; i--) {
      const monthStart = dayjs().subtract(i, 'month').startOf('month');
      const monthEnd = dayjs().subtract(i, 'month').endOf('month');

      const monthSales = sales.filter(sale =>
        dayjs(sale.order.updatedAt).isBetween(monthStart, monthEnd, null, '[]')
      );

      const monthRevenue = monthSales.reduce((sum, sale) => sum + (sale.totalPrice || 0), 0);
      const monthBooksSold = monthSales.reduce((sum, sale) => sum + sale.quantity, 0);

      monthlyRevenue.push({
        period: monthStart.format('YYYY-MM'),
        revenue: Number(monthRevenue.toFixed(2)),
        sales: monthSales.length,
        booksSold: monthBooksSold
      });
    }

    // Calcular médias
    const averageRevenuePerSale = basicRevenue.totalSales > 0 ?
      Number((basicRevenue.totalRevenue / basicRevenue.totalSales).toFixed(2)) : 0;

    const averageRevenuePerBook = basicRevenue.totalBooksSold > 0 ?
      Number((basicRevenue.totalRevenue / basicRevenue.totalBooksSold).toFixed(2)) : 0;

    return {
      ...basicRevenue,
      monthlyRevenue,
      averageRevenuePerSale,
      averageRevenuePerBook
    };
  }
  async getAdminRevenueByUserId(userId: string): Promise<AdminRevenueDto> {
    console.log('🔥 AdminService.getAdminRevenueByUserId - Iniciado para userId:', userId);

    // Buscar admin pelo userId
    const admin = await this.prisma.admin.findUnique({
      where: { userId }, // ← Buscar pelo userId
      include: { adminUser: true }
    });

    console.log('🔥 Admin encontrado pelo userId:', admin ? 'SIM' : 'NÃO');

    if (!admin) {
      console.log('❌ Admin não encontrado para userId:', userId);
      throw new NotFoundException('Admin not found');
    }

    console.log('✅ Admin encontrado, redirecionando para getAdminRevenue com adminId:', admin.id);

    // Agora usar o adminId correto
    return this.getAdminRevenue(admin.id);
  }

  async getAdminRevenueDetailedByUserId(userId: string): Promise<AdminRevenueDetailedDto> {
    console.log('🔥 AdminService.getAdminRevenueDetailedByUserId - Iniciado para userId:', userId);

    // Buscar admin pelo userId
    const admin = await this.prisma.admin.findUnique({
      where: { userId }, // ← Buscar pelo userId
      include: { adminUser: true }
    });

    console.log('🔥 Admin encontrado pelo userId:', admin ? 'SIM' : 'NÃO');

    if (!admin) {
      console.log('❌ Admin não encontrado para userId:', userId);
      throw new NotFoundException('Admin not found');
    }

    console.log('✅ Admin encontrado, redirecionando para getAdminRevenueDetailed com adminId:', admin.id);

    // Agora usar o adminId correto
    return this.getAdminRevenueDetailed(admin.id);
  }
  async getAllAdminsRevenue(): Promise<AdminRevenueDto[]> {
    console.log('🔥 AdminService.getAllAdminsRevenue - Iniciado');

    try {
      const admins = await this.prisma.admin.findMany({
        include: { adminUser: true }
      });

      console.log('🔥 Admins encontrados:', admins.length);
      console.log('🔥 Lista de admins:', admins.map(admin => ({
        id: admin.id,
        userId: admin.userId,
        userName: admin.adminUser?.name
      })));

      const revenues = await Promise.all(
        admins.map(admin => this.getAdminRevenue(admin.id))
      );

      console.log('✅ Receitas calculadas para todos os admins');
      return revenues.sort((a, b) => b.totalRevenue - a.totalRevenue);

    } catch (error) {
      console.error('❌ Erro em getAllAdminsRevenue:', error);
      throw error;
    }
  }

  // Métodos para gerenciar tokens dos admins
  async getAdminToken(adminId: string): Promise<any> {
    const adminToken = await this.prisma.$queryRaw`
      SELECT at.id, at."adminId", at.token, at.title, at."isActive", at."createdAt", at."updatedAt", u.name, u.email
      FROM admin_tokens at
      JOIN users u ON at."adminId" = u.id
      WHERE at."adminId" = ${adminId}
    `;

    if (!adminToken || !Array.isArray(adminToken) || adminToken.length === 0) {
      return null;
    }

    const token = adminToken[0];
    return {
      id: token.id,
      adminId: token.adminId,
      token: token.token,
      title: token.title,
      isActive: token.isActive,
      createdAt: token.createdAt,
      updatedAt: token.updatedAt,
      adminName: token.name,
      adminEmail: token.email,
    };
  }

  async createAdminToken(data: { adminId: string; token: string; title?: string }): Promise<any> {
    // Verificar se o admin existe
    const admin = await this.prisma.user.findUnique({
      where: { id: data.adminId },
      include: { admin: true },
    });

    if (!admin || !admin.admin) {
      throw new NotFoundException('Admin não encontrado');
    }

    // Verificar se já existe um token para este admin
    const existingToken = await this.prisma.$queryRaw`
      SELECT id FROM admin_tokens WHERE "adminId" = ${data.adminId}
    `;

    if (existingToken && Array.isArray(existingToken) && existingToken.length > 0) {
      throw new ConflictException('Admin já possui um token cadastrado');
    }

    // Criar novo token
    const result = await this.prisma.$executeRaw`
      INSERT INTO admin_tokens (id, "adminId", token, title, "isActive", "createdAt", "updatedAt")
      VALUES (gen_random_uuid(), ${data.adminId}, ${data.token}, ${data.title || 'Token Principal'}, true, NOW(), NOW())
    `;

    // Buscar o token criado
    const adminToken = await this.prisma.$queryRaw`
      SELECT at.id, at."adminId", at.token, at.title, at."isActive", at."createdAt", at."updatedAt", u.name, u.email
      FROM admin_tokens at
      JOIN users u ON at."adminId" = u.id
      WHERE at."adminId" = ${data.adminId}
    `;

    const token = adminToken[0];
    return {
      id: token.id,
      adminId: token.adminId,
      token: token.token,
      title: token.title,
      isActive: token.isActive,
      createdAt: token.createdAt,
      updatedAt: token.updatedAt,
      adminName: token.name,
      adminEmail: token.email,
    };
  }

  async updateAdminToken(adminId: string, data: { token?: string; title?: string; isActive?: boolean }): Promise<any> {
    const adminToken = await this.prisma.$queryRaw`
      SELECT id FROM admin_tokens WHERE "adminId" = ${adminId}
    `;

    if (!adminToken || !Array.isArray(adminToken) || adminToken.length === 0) {
      throw new NotFoundException('Token do admin não encontrado');
    }

    // Construir query de update dinamicamente
    const updateFields = [];
    const values = [];

    if (data.token !== undefined) {
      updateFields.push('token = $1');
      values.push(data.token);
    }
    if (data.title !== undefined) {
      updateFields.push('title = $2');
      values.push(data.title);
    }
    if (data.isActive !== undefined) {
      updateFields.push('"isActive" = $3');
      values.push(data.isActive);
    }

    updateFields.push('"updatedAt" = NOW()');

    if (updateFields.length > 0) {
      await this.prisma.$executeRawUnsafe(`
        UPDATE admin_tokens 
        SET ${updateFields.join(', ')}
        WHERE "adminId" = $${values.length + 1}
      `, ...values, adminId);
    }

    // Buscar o token atualizado
    const updatedToken = await this.prisma.$queryRaw`
      SELECT at.id, at."adminId", at.token, at.title, at."isActive", at."createdAt", at."updatedAt", u.name, u.email
      FROM admin_tokens at
      JOIN users u ON at."adminId" = u.id
      WHERE at."adminId" = ${adminId}
    `;

    const token = updatedToken[0];
    return {
      id: token.id,
      adminId: token.adminId,
      token: token.token,
      title: token.title,
      isActive: token.isActive,
      createdAt: token.createdAt,
      updatedAt: token.updatedAt,
      adminName: token.name,
      adminEmail: token.email,
    };
  }

  async deleteAdminToken(adminId: string): Promise<void> {
    const adminToken = await this.prisma.$queryRaw`
      SELECT id FROM admin_tokens WHERE "adminId" = ${adminId}
    `;

    if (!adminToken || !Array.isArray(adminToken) || adminToken.length === 0) {
      throw new NotFoundException('Token do admin não encontrado');
    }

    await this.prisma.$executeRaw`
      DELETE FROM admin_tokens WHERE "adminId" = ${adminId}
    `;
  }

  async getAllAdminTokens(): Promise<any[]> {
    const adminTokens = await this.prisma.$queryRaw`
      SELECT at.id, at."adminId", at.token, at.title, at."isActive", at."createdAt", at."updatedAt", u.name, u.email
      FROM admin_tokens at
      JOIN users u ON at."adminId" = u.id
    `;

    if (!Array.isArray(adminTokens)) {
      return [];
    }

    return adminTokens.map(token => ({
      id: token.id,
      adminId: token.adminId,
      token: token.token,
      title: token.title,
      isActive: token.isActive,
      createdAt: token.createdAt,
      updatedAt: token.updatedAt,
      adminName: token.name,
      adminEmail: token.email,
    }));
  }
}
