import { Body, Controller, Get, Headers, HttpCode, NotFoundException, Param, Post, Query, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Controller('internal')
export class InternalStatsController {
  constructor(private readonly prisma: PrismaService) {}

  private ensureInternalToken(token?: string) {
    const expected = process.env.API_MACHINE_INTERNAL_TOKEN || process.env.INTERNAL_SERVICE_TOKEN;
    if (!expected || token !== expected) {
      throw new UnauthorizedException('Token interno inválido');
    }
  }

  @Get('stats')
  async stats(@Headers('x-internal-token') token?: string) {
    this.ensureInternalToken(token);

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [totalContas, activeSellerBooks] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.book.findMany({
        where: {
          createdById: { not: null },
          orderItems: {
            some: {
              order: { createdAt: { gte: startOfMonth } },
            },
          },
        },
        select: { createdById: true },
      }),
    ]);

    const sellersAtivos = new Set(activeSellerBooks.map((b) => b.createdById)).size;

    return { totalContas, sellersAtivos };
  }

  @Get('users/list')
  async listUsers(
    @Headers('x-internal-token') token: string | undefined,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
  ) {
    this.ensureInternalToken(token);
    const pageNum = Math.max(1, Number(page));
    const size = Math.min(Math.max(1, Number(pageSize)), 100);
    const skip = (pageNum - 1) * size;

    const [total, users] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.findMany({
        skip,
        take: size,
        orderBy: { createdAt: 'desc' },
        select: { id: true, name: true, email: true, cpf: true, createdAt: true, isActive: true },
      }),
    ]);

    return { data: users, total, page: pageNum, pageSize: size };
  }

  /** Pedidos pagos que usaram o código pessoal do afiliado (?ref=CODE), com ou sem comissão. */
  private async paidOrdersByCode(codes: string[]) {
    if (codes.length === 0) return [];
    return this.prisma.order.findMany({
      where: { affiliateCode: { in: codes }, paymentStatus: 'paid' },
      select: { id: true, affiliateCode: true, userId: true, user: { select: { id: true, name: true, email: true, cpf: true } } },
    });
  }

  /** Afiliados do Ebook (link de produto, comissão ou venda pelo código pessoal). Somente leitura. */
  @Get('affiliates')
  async listAffiliates(@Headers('x-internal-token') token?: string) {
    this.ensureInternalToken(token);

    const coded = await this.prisma.user.findMany({
      where: { affiliateCode: { not: null } },
      select: { id: true, affiliateCode: true },
    });
    const codeToUser = new Map(coded.map((u) => [u.affiliateCode as string, u.id]));
    const codeOrders = await this.paidOrdersByCode([...codeToUser.keys()]);

    const soldViaCode = new Set(codeOrders.map((o) => codeToUser.get((o.affiliateCode ?? '').toUpperCase())).filter(Boolean) as string[]);

    const users = await this.prisma.user.findMany({
      where: {
        OR: [
          { affiliateProductLinks: { some: {} } },
          { affiliateCommissions: { some: {} } },
          { id: { in: [...soldViaCode] } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        email: true,
        affiliateCode: true,
        affiliateCommissions: {
          where: { status: { not: 'REVERSED' } },
          orderBy: { createdAt: 'desc' },
          select: { orderId: true, commissionAmount: true, commissionRate: true, order: { select: { userId: true } } },
        },
      },
    });

    const data = users.map((u) => {
      const comms = u.affiliateCommissions;
      const buyers = new Set(comms.map((c) => c.order.userId));
      for (const o of codeOrders) {
        if (codeToUser.get((o.affiliateCode ?? '').toUpperCase()) === u.id) buyers.add(o.userId);
      }
      return {
        id: u.id,
        name: u.name,
        email: u.email,
        affiliateCode: u.affiliateCode ?? null,
        commissionPercent: comms[0] ? comms[0].commissionRate : null,
        totalReferrals: buyers.size,
        totalCommission: comms.reduce((sum, c) => sum + c.commissionAmount, 0),
      };
    });

    return { data };
  }

  /** Compradores (indicados) de um afiliado do Ebook, com a comissão gerada por cada um. */
  @Get('affiliates/:id')
  async affiliateDetail(@Headers('x-internal-token') token: string | undefined, @Param('id') id: string) {
    this.ensureInternalToken(token);

    const affiliate = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, name: true, email: true, cpf: true, affiliateCode: true },
    });
    const [comms, codeOrders] = await Promise.all([
      this.prisma.affiliateCommission.findMany({
        where: { affiliateId: id, status: { not: 'REVERSED' } },
        select: {
          commissionAmount: true,
          order: { select: { user: { select: { id: true, name: true, email: true, cpf: true } } } },
        },
      }),
      this.paidOrdersByCode(affiliate?.affiliateCode ? [affiliate.affiliateCode] : []),
    ]);

    const byBuyer = new Map<string, { id: string; name: string; email: string; cpf: string | null; generated: number }>();
    const touch = (u: { id: string; name: string; email: string; cpf: string | null }) =>
      byBuyer.get(u.id) ?? { id: u.id, name: u.name, email: u.email, cpf: u.cpf ?? null, generated: 0 };
    for (const o of codeOrders) byBuyer.set(o.user.id, touch(o.user));
    for (const c of comms) {
      const cur = touch(c.order.user);
      cur.generated += c.commissionAmount;
      byBuyer.set(c.order.user.id, cur);
    }

    return { data: { affiliate, referrals: [...byBuyer.values()] } };
  }

  @Post('users/deactivate')
  @HttpCode(200)
  async deactivateUser(
    @Headers('x-internal-token') token: string | undefined,
    @Body() body: { cpf?: string },
  ) {
    this.ensureInternalToken(token);

    const cpf = body?.cpf?.replace(/\D/g, '');
    if (!cpf) throw new NotFoundException('CPF não informado');

    const user = await this.prisma.user.findUnique({ where: { cpf } });
    if (!user) return { deactivated: false, reason: 'not_found' };

    await this.prisma.user.update({ where: { cpf }, data: { isActive: false } });
    return { deactivated: true };
  }

  /** Reativa o usuário — espelho do deactivate. Usado quando o master reativa a conta no SIM INT PAY. */
  @Post('users/activate')
  @HttpCode(200)
  async activateUser(
    @Headers('x-internal-token') token: string | undefined,
    @Body() body: { cpf?: string },
  ) {
    this.ensureInternalToken(token);

    const cpf = body?.cpf?.replace(/\D/g, '');
    if (!cpf) throw new NotFoundException('CPF não informado');

    const user = await this.prisma.user.findUnique({ where: { cpf } });
    if (!user) return { activated: false, reason: 'not_found' };

    await this.prisma.user.update({ where: { cpf }, data: { isActive: true } });
    return { activated: true };
  }

  @Post('users/update')
  @HttpCode(200)
  async updateUser(
    @Headers('x-internal-token') token: string | undefined,
    @Body() body: { cpf: string; name?: string; email?: string; newCpf?: string },
  ) {
    this.ensureInternalToken(token);

    const cpf = body?.cpf?.replace(/\D/g, '');
    if (!cpf) return { updated: false, reason: 'cpf_required' };

    const user = await this.prisma.user.findUnique({ where: { cpf } });
    if (!user) return { updated: false, reason: 'not_found' };

    const data: Record<string, any> = {};
    if (body.name?.trim()) data.name = body.name.trim();
    if (body.email?.trim()) data.email = body.email.trim().toLowerCase();
    if (body.newCpf) data.cpf = body.newCpf.replace(/\D/g, '');

    if (Object.keys(data).length === 0) return { updated: false, reason: 'no_changes' };

    await this.prisma.user.update({ where: { cpf }, data });
    return { updated: true };
  }
}
