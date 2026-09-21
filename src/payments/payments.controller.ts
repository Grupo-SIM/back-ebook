import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  ServiceUnavailableException,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuardAdmin } from 'src/auth/guard/jwt-auth.guard';
import { GetUser } from 'src/common/decorators/user.decorator';
import { RequestWithUser } from 'src/common/interfaces/request-with-user.interface';
import { PrismaService } from '../../prisma/prisma.service';
import { isValidCpf, normalizeCpf } from 'src/common/utils/cpf.util';
import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsString, Min } from 'class-validator';

export class WithdrawRequestDto {
  @ApiProperty({ description: 'Valor a ser sacado', example: 100.50 })
  @IsNumber()
  @Min(0.01)
  amount: number;

  @ApiProperty({ description: 'Chave PIX para recebimento', example: '12345678909' })
  @IsString()
  pixKey: string;
}

@ApiTags('Payments')
@Controller('payments')
@UseGuards(JwtAuthGuardAdmin)
@ApiBearerAuth()
export class PaymentsController {
  constructor(private readonly prisma: PrismaService) {}

  private parseDateOnlyStart(input?: string): Date | undefined {
    if (!input) return undefined;
    const d = new Date(`${input}T00:00:00.000Z`);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }

  private parseDateOnlyEnd(input?: string): Date | undefined {
    if (!input) return undefined;
    const d = new Date(`${input}T23:59:59.999Z`);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }

  private parseDomDate(raw?: string): Date | null {
    if (!raw) return null;
    const normalized = raw.trim().replace(' ', 'T');
    const withTimezone = normalized.includes('Z') || /[+-]\d{2}:\d{2}$/.test(normalized)
      ? normalized
      : `${normalized}-03:00`;
    const d = new Date(withTimezone);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  private getApiMachineUrl() {
    const base = process.env.API_MACHINE_URL || process.env.API_MACHINE_INTERNAL_URL;
    if (!base) {
      throw new ServiceUnavailableException('Integração com API Machine não configurada');
    }
    return base.replace(/\/+$/, '');
  }

  private getInternalToken() {
    const token =
      process.env.API_MACHINE_INTERNAL_TOKEN ||
      process.env.INTERNAL_SERVICE_TOKEN;
    if (!token) {
      throw new ServiceUnavailableException('Token interno da integração não configurado');
    }
    return token;
  }

  private async getCpfFromUser(user: RequestWithUser['user']): Promise<string> {
    const dbUser = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { cpf: true },
    });
    const cpf = normalizeCpf(dbUser?.cpf ?? '');
    if (!isValidCpf(cpf)) {
      throw new BadRequestException('CPF inválido ou não configurado para acessar o financeiro');
    }
    return cpf;
  }

  private async machineGet(path: string, cpf: string, query?: Record<string, string | number | undefined>) {
    const search = new URLSearchParams({ cpf });
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined && v !== null && `${v}` !== '') search.set(k, String(v));
    }
    const response = await fetch(`${this.getApiMachineUrl()}${path}?${search.toString()}`, {
      headers: {
        'x-internal-token': this.getInternalToken(),
        'Content-Type': 'application/json',
      },
    });
    if (!response.ok) {
      const text = await response.text();
      throw new ServiceUnavailableException(`Falha ao consultar API Machine: ${response.status} ${text}`);
    }
    return response.json();
  }

  private async machineGetDomTransactions(params: {
    beginDate: string;
    endDate: string;
    page: number;
    limit: number;
  }): Promise<any[]> {
    const search = new URLSearchParams({
      page: String(params.page),
      limit: String(params.limit),
      begin_date: params.beginDate,
      end_date: params.endDate,
      status: 'paid',
    });

    const response = await fetch(`${this.getApiMachineUrl()}/admin/transacoes-dom?${search.toString()}`, {
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data?.data?.transactions) ? data.data.transactions : [];
  }

  private normalizeText(value: string | null | undefined): string {
    return String(value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  private async reconcileLocalPendingOrdersWithDom(orders: any[]): Promise<Set<number>> {
    if (orders.length === 0) return new Set<number>();

    const minDate = new Date(
      Math.min(...orders.map((o) => new Date(o.createdAt).getTime())),
    );
    const maxDate = new Date();
    const beginDate = minDate.toISOString().slice(0, 10);
    const endDate = maxDate.toISOString().slice(0, 10);

    const domTxs: any[] = [];
    for (let page = 1; page <= 10; page++) {
      const chunk = await this.machineGetDomTransactions({
        beginDate,
        endDate,
        page,
        limit: 200,
      });
      if (chunk.length === 0) break;
      domTxs.push(...chunk);
      if (chunk.length < 200) break;
    }

    if (domTxs.length === 0) return new Set<number>();

    const paidOrderIds = new Set<number>();
    for (const order of orders) {
      const orderEmail = this.normalizeText(order?.user?.email);
      const orderAmount = Number(order?.totalAmount ?? 0);
      const orderTitle = this.normalizeText(order?.orderItems?.[0]?.book?.title);
      const orderCreatedAt = new Date(order.createdAt).getTime();

      if (!orderEmail || !orderTitle || !Number.isFinite(orderAmount)) continue;

      const matched = domTxs.find((tx) => {
        const txStatus = this.normalizeText(tx?.status);
        if (!['paid', 'approved', 'completed'].includes(txStatus)) return false;

        const txEmail = this.normalizeText(tx?.customer_email);
        const txTitle = this.normalizeText(tx?.product_first);
        const txAmount = Number(tx?.amount ?? 0);
        const txCreatedAt = this.parseDomDate(tx?.created_at)?.getTime();

        if (!txEmail || txEmail !== orderEmail) return false;
        if (Math.abs(txAmount - orderAmount) > 0.0001) return false;
        if (!(txTitle.includes(orderTitle) || orderTitle.includes(txTitle))) return false;
        if (!txCreatedAt) return false;

        // Janela de 6h para evitar casar com compra antiga
        return Math.abs(txCreatedAt - orderCreatedAt) <= 6 * 60 * 60 * 1000;
      });

      if (!matched) continue;

      await this.prisma.order.update({
        where: { id: order.id },
        data: {
          status: 'paid',
          paymentStatus: 'paid',
        },
      });
      paidOrderIds.add(order.id);
    }

    return paidOrderIds;
  }

  private async listLocalSellerTransactions(params: {
    cpf: string;
    status?: string;
    description?: string;
    startDate?: string;
    endDate?: string;
  }) {
    const normalizedStatus = String(params.status || '').toUpperCase();

    // Local orders only ever have PAID or PENDING — all other statuses come exclusively from machine
    const LOCAL_STATUSES = new Set(['PAID', 'COMPLETED', 'PENDING', 'ALL', '']);
    if (!LOCAL_STATUSES.has(normalizedStatus)) return [];

    const where: any = {
      store: 'ebook',
      notes: {
        contains: `[CPF_DONO:${params.cpf}]`,
      },
    };

    // Se filtro de status for explicitamente PAID/COMPLETED, só busca pagos
    if (normalizedStatus === 'PAID' || normalizedStatus === 'COMPLETED') {
      where.AND = [{ status: 'paid' }, { paymentStatus: 'paid' }];
    } else if (normalizedStatus === 'PENDING') {
      where.OR = [{ status: 'pending' }, { paymentStatus: 'pending' }];
    }
    // ALL ou sem filtro: busca tudo (sem restrição de status)

    const start = this.parseDateOnlyStart(params.startDate);
    const end = this.parseDateOnlyEnd(params.endDate);
    if (start || end) {
      where.createdAt = {};
      if (start) where.createdAt.gte = start;
      if (end) where.createdAt.lte = end;
    }

    const orders = await this.prisma.order.findMany({
      where,
      include: {
        user: { select: { name: true, email: true } },
        orderItems: {
          include: { book: { select: { title: true } } },
          take: 1,
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 5000,
    });

    // Reconcilia apenas os pendentes com a DOM para detectar pagos não atualizados
    const pendingOrders = orders.filter(
      (o) => o.status === 'pending' || o.paymentStatus === 'pending',
    );
    const reconciledPaidOrderIds = await this.reconcileLocalPendingOrdersWithDom(pendingOrders);

    const normalizedDescription = String(params.description || '').trim().toLowerCase();

    return orders
      .map((order) => {
        const isPaid =
          order.status === 'paid' ||
          order.paymentStatus === 'paid' ||
          reconciledPaidOrderIds.has(order.id);
        const firstBookTitle = order.orderItems?.[0]?.book?.title || 'Pedido Ebook';
        return {
          id: `ebook-order-${order.id}`,
          userId: null,
          amount: Number(order.totalAmount ?? 0),
          name: order.user?.name ?? null,
          email: order.user?.email ?? null,
          status: isPaid ? 'PAID' : 'PENDING',
          description: `Pedido ${order.orderNumber} - ${firstBookTitle}`,
          appliedGlobalFee: false,
          fee: 0,
          dom_fee: 0,
          payment_method: (order.paymentMethod || 'pix').toString().toLowerCase(),
          amountWithoutAllFee: order.netAmount != null
            ? Number(order.netAmount)
            : Number((Number(order.totalAmount ?? 0) * 0.91).toFixed(2)), // Transações antigas sem netAmount ficam com o padrão histórico de 91%
          walletId: null,
          createdAt: order.createdAt,
          paymentId: `ORDER:${order.orderNumber}`,
          updatedAt: order.updatedAt,
        };
      })
      .filter((tx) => {
        if (!normalizedDescription || normalizedDescription === 'all') return true;
        return tx.description.toLowerCase().includes(normalizedDescription);
      });
  }

  @Get('summary')
  async summary(@GetUser() user: RequestWithUser['user']) {
    const cpf = await this.getCpfFromUser(user);
    const machineSummary = await this.machineGet('/internal/ebook/finance/summary', cpf);

    // Sem conta ativa no Simintpay: gateway não tem onde guardar saldo.
    // Calcula um saldo estimado a partir dos pedidos pagos localmente, só para exibição —
    // saque continua bloqueado até a conta ser criada lá.
    if (machineSummary?.accountExists !== true) {
      const paidOrders = await this.prisma.order.findMany({
        where: {
          store: 'ebook',
          notes: { contains: `[CPF_DONO:${cpf}]` },
          AND: [{ status: 'paid' }, { paymentStatus: 'paid' }],
        },
        select: { netAmount: true, totalAmount: true },
      });
      const estimatedBalance = paidOrders.reduce(
        (sum, o) => sum + Number(o.netAmount ?? Number(o.totalAmount ?? 0) * 0.91),
        0,
      );
      return {
        ...machineSummary,
        availableBalance: Number(estimatedBalance.toFixed(2)),
        estimatedLocalBalance: true,
      };
    }

    return machineSummary;
  }

  @Get('history')
  async history(
    @GetUser() user: RequestWithUser['user'],
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('status') status?: string,
    @Query('description') description?: string,
  ) {
    const cpf = await this.getCpfFromUser(user);
    const pageNum = Math.max(1, Number(page || 1));
    const limitNum = Math.min(Math.max(1, Number(limit || 10)), 200);

    // Machine API uses COMPLETED for paid, not PAID
    const normalizedStatus = String(status || '').toUpperCase();
    const machineStatus = normalizedStatus === 'PAID' ? 'COMPLETED' : (normalizedStatus || undefined);

    const machineData = await this.machineGet('/internal/ebook/finance/transactions', cpf, {
      page: 1,
      limit: 5000,
      startDate,
      endDate,
      status: machineStatus,
      description,
    });

    const localPending = await this.listLocalSellerTransactions({
      cpf,
      status,
      description,
      startDate,
      endDate,
    });

    const machineTxs = (Array.isArray(machineData?.transactions) ? machineData.transactions : [])
      .map((tx: any) => ({
        ...tx,
        // Normalize COMPLETED → PAID so frontend sees consistent status
        status: tx.status === 'COMPLETED' ? 'PAID' : tx.status,
      }));

    // Extrai orderNumbers presentes nas transações da machine (descrição começa com o orderNumber antes de [TENANT:])
    const machineOrderNums = new Set<string>();
    for (const tx of machineTxs) {
      const m = String(tx.description || '').match(/^([A-Z0-9-]+)\s*\[TENANT:/i);
      if (m) machineOrderNums.add(m[1].trim());
    }

    // Remove locais que já existem na machine (evita duplicatas)
    const filteredLocal = localPending.filter(tx => {
      const ordNum = String(tx.paymentId || '').replace(/^ORDER:/, '');
      return !machineOrderNums.has(ordNum);
    });

    const merged = [...machineTxs, ...filteredLocal];
    const uniqueByKey = new Map<string, any>();
    for (const tx of merged) {
      const key = String(tx?.paymentId || tx?.id || '');
      if (!key) continue;
      if (!uniqueByKey.has(key)) uniqueByKey.set(key, tx);
    }

    const mergedSorted = [...uniqueByKey.values()].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    const totalItems = mergedSorted.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / limitNum));
    const startIdx = (pageNum - 1) * limitNum;
    const endIdx = startIdx + limitNum;

    const commissionWhere: any = { affiliateId: user.id, status: 'CREDITED' };
    if (startDate || endDate) {
      commissionWhere.createdAt = {};
      const start = this.parseDateOnlyStart(startDate);
      const end = this.parseDateOnlyEnd(endDate);
      if (start) commissionWhere.createdAt.gte = start;
      if (end) commissionWhere.createdAt.lte = end;
    }
    const commissionAgg = await this.prisma.affiliateCommission.aggregate({
      where: commissionWhere,
      _sum: { commissionAmount: true },
    });
    const totalAffiliateCommissions = Number((commissionAgg._sum.commissionAmount ?? 0).toFixed(2));

    return {
      transactions: mergedSorted.slice(startIdx, endIdx),
      meta: {
        currentPage: pageNum,
        itemsPerPage: limitNum,
        totalItems,
        totalPages,
        totalAffiliateCommissions,
      },
    };
  }

  @Get('withdrawals')
  async withdrawals(
    @GetUser() user: RequestWithUser['user'],
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const cpf = await this.getCpfFromUser(user);
    return this.machineGet('/internal/ebook/finance/withdrawals', cpf, {
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 10,
    });
  }

  @Post('withdraw')
  @ApiOperation({ summary: 'Solicitar saque' })
  async withdraw(
    @GetUser() user: RequestWithUser['user'],
    @Body() body: WithdrawRequestDto,
  ) {
    if (!body.amount || isNaN(Number(body.amount)) || body.amount <= 0) {
      throw new BadRequestException('Valor de saque inválido ou não informado.');
    }
    if (!body.pixKey) {
      throw new BadRequestException('Chave PIX é obrigatória.');
    }

    const cpf = await this.getCpfFromUser(user);
    const response = await fetch(`${this.getApiMachineUrl()}/internal/ebook/finance/withdraw`, {
      method: 'POST',
      headers: {
        'x-internal-token': this.getInternalToken(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        cpf,
        amount: Number(body.amount),
        pixKey: body.pixKey,
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new ServiceUnavailableException(`Falha ao solicitar saque: ${response.status} ${text}`);
    }
    return response.json();
  }

  @Get('all-transactions-excel')
  async allTransactionsExcel(
    @GetUser() user: RequestWithUser['user'],
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('status') status?: string,
    @Query('description') description?: string,
  ) {
    const cpf = await this.getCpfFromUser(user);
    const data = await this.machineGet('/internal/ebook/finance/transactions', cpf, {
      page: 1,
      limit: 5000,
      startDate,
      endDate,
      status,
      description,
    });
    return data?.transactions ?? [];
  }

  @Get('monthly-revenue')
  async monthlyRevenue(
    @GetUser() user: RequestWithUser['user'],
    @Query('month') month?: string,
    @Query('year') year?: string,
  ) {
    const cpf = await this.getCpfFromUser(user);
    const now = new Date();
    const m = Math.min(12, Math.max(1, Number(month || now.getMonth() + 1)));
    const y = Math.max(2000, Number(year || now.getFullYear()));
    const start = new Date(Date.UTC(y, m - 1, 1));
    const end = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999));
    const startDate = start.toISOString().slice(0, 10);
    const endDate = end.toISOString().slice(0, 10);

    const data = await this.machineGet('/internal/ebook/finance/transactions', cpf, {
      page: 1,
      limit: 5000,
      startDate,
      endDate,
      status: 'COMPLETED',
    });
    const txs = Array.isArray(data?.transactions) ? data.transactions : [];

    const totalGross = txs.reduce((s: number, t: any) => s + Number(t.amount || 0), 0);
    const totalNet = txs.reduce((s: number, t: any) => s + Number(t.amountWithoutAllFee || 0), 0);
    const totalFees = txs.reduce((s: number, t: any) => s + Number(t.fee || 0), 0);
    const totalDomFees = txs.reduce((s: number, t: any) => s + Number(t.dom_fee || 0), 0);
    const totalTx = txs.length;

    const totalAffiliateCommissions = await this.getAffiliateCommissionsEarned(user.id, start, end);

    const monthName = new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long' });

    return {
      period: {
        month: m,
        year: y,
        startDate,
        endDate,
        monthName: monthName.charAt(0).toUpperCase() + monthName.slice(1),
      },
      summary: {
        totalTransactions: totalTx,
        totalGross: Number(totalGross.toFixed(2)),
        totalNet: Number(totalNet.toFixed(2)),
        totalFees: Number(totalFees.toFixed(2)),
        totalDomFees: Number(totalDomFees.toFixed(2)),
        totalAffiliateCommissions,
        averageTransactionValue: totalTx > 0 ? Number((totalGross / totalTx).toFixed(2)) : 0,
        averageNetValue: totalTx > 0 ? Number((totalNet / totalTx).toFixed(2)) : 0,
      },
      transactions: txs,
    };
  }

  /**
   * Soma das comissões de afiliado (CREDITED) ganhas pelo admin no período,
   * já incluídas fisicamente no saldo sacável via creditOnSimintpay — aqui é
   * só para exibição/conferência no relatório, não afeta o saldo real.
   */
  private async getAffiliateCommissionsEarned(userId: string, start: Date, end: Date): Promise<number> {
    const result = await this.prisma.affiliateCommission.aggregate({
      where: {
        affiliateId: userId,
        status: 'CREDITED',
        createdAt: { gte: start, lte: end },
      },
      _sum: { commissionAmount: true },
    });
    return Number((result._sum.commissionAmount ?? 0).toFixed(2));
  }
}

