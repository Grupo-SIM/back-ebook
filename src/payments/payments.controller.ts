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
import type { RequestWithUser } from 'src/common/interfaces/request-with-user.interface';
import { PrismaService } from '../../prisma/prisma.service';
import { isValidCpf, isValidCnpj, normalizeCpf } from 'src/common/utils/cpf.util';
import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { calcNetAmount, getSellerFees, parseSellerFees, SellerFees } from 'src/common/seller-fees';
import {
  isMerchantNotAssociated,
  isOrderPaymentCompleted,
  isMerchantWithoutAccount,
  merchantFees,
  merchantQuote,
  merchantSummary,
  merchantTransactions,
  platformFinanceConfig,
  merchantWithdraw,
  merchantWithdrawals,
  SimintpayPlatformError,
} from 'src/common/simintpay-platform';
import {
  mapCanonicalSummary,
  mapCanonicalTransaction,
  mapCanonicalWithdrawals,
  mapPlatformConfigFallback,
  mapWithdrawalQuote,
  withdrawalIdempotencyKey,
} from './canonical-finance';

export class WithdrawRequestDto {
  @ApiProperty({ description: 'Valor a ser sacado', example: 100.50 })
  @IsNumber()
  @Min(0.01)
  amount: number;

  @ApiProperty({ description: 'Chave PIX para recebimento', example: '12345678909' })
  @IsString()
  pixKey: string;

  @ApiProperty({
    required: false,
    description: 'Chave de idempotência opcional (também aceita no header Idempotency-Key). Sem ela, é derivada de usuário+valor+PIX+minuto.',
  })
  @IsOptional()
  @IsString()
  idempotencyKey?: string;
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

  // Mesma tag gravada no checkout (buildInternalOrderTag): CNPJ_DONO p/ 14 dígitos, CPF_DONO p/ 11.
  private ownerTag(doc: string): string {
    return doc.length === 14 ? `[CNPJ_DONO:${doc}]` : `[CPF_DONO:${doc}]`;
  }

  /**
   * Líquido de um pedido local. Usa o netAmount gravado na venda; para pedidos antigos sem ele,
   * calcula com as taxas do vendedor no método de pagamento (mesma fonte de /taxa).
   */
  private localNetAmount(order: { netAmount: number | null; totalAmount: number | null }, fees: SellerFees | null): number {
    if (order.netAmount != null) return Number(order.netAmount);
    const gross = Number(order.totalAmount ?? 0);
    // Sem taxas disponíveis: padrão histórico de 91%
    return fees ? calcNetAmount(gross, fees) : Number((gross * 0.91).toFixed(2));
  }

  private async getCpfFromUser(user: RequestWithUser['user']): Promise<string> {
    const dbUser = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { cpf: true, cnpj: true },
    });
    const cnpj = normalizeCpf(dbUser?.cnpj ?? '');
    if (isValidCnpj(cnpj)) {
      return cnpj;
    }
    const cpf = normalizeCpf(dbUser?.cpf ?? '');
    if (!isValidCpf(cpf)) {
      throw new BadRequestException('CPF ou CNPJ inválido ou não configurado para acessar o financeiro');
    }
    return cpf;
  }

  /**
   * Confirma pedidos pendentes consultando o SimIntPay por número do pedido
   * (finance/transactions?status=COMPLETED&description=<orderNumber> do vendedor). Substitui a heurística de
   * /admin/transacoes-dom (e-mail + valor + título + janela). Pedidos com liquidação não aparecem aqui
   * (são confirmados por recibos/webhook).
   */
  private async reconcileLocalPendingOrders(orders: any[], document: string): Promise<Set<number>> {
    const paidOrderIds = new Set<number>();
    for (const order of orders.slice(0, 50)) {
      if (!(await isOrderPaymentCompleted(document, String(order.orderNumber ?? '')))) continue;
      await this.prisma.order.update({
        where: { id: order.id },
        data: { status: 'paid', paymentStatus: 'paid' },
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
        contains: this.ownerTag(params.cpf),
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
    const reconciledPaidOrderIds = await this.reconcileLocalPendingOrders(pendingOrders, params.cpf);

    const normalizedDescription = String(params.description || '').trim().toLowerCase();
    const sellerFees = orders.some((o) => o.netAmount == null) ? await getSellerFees(params.cpf) : null;

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
          amountWithoutAllFee: this.localNetAmount(order, sellerFees),
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

  /**
   * Transações do vendedor: API Machine (gateway) + pedidos locais ainda não refletidos lá,
   * sem duplicatas, ordenadas da mais recente para a mais antiga.
   * Fonte única para Relatórios e Dashboard.
   */
  private async listSellerTransactions(params: {
    cpf: string;
    startDate?: string;
    endDate?: string;
    status?: string;
    description?: string;
  }): Promise<any[]> {
    const { cpf, startDate, endDate, status, description } = params;

    // Machine API uses COMPLETED for paid, not PAID
    const normalizedStatus = String(status || '').toUpperCase();
    const machineStatus = normalizedStatus === 'PAID' ? 'COMPLETED' : (normalizedStatus || undefined);

    const machineData = await this.machineTransactions(cpf, {
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

    return mergedSorted;
  }

  /** Traduz erros do SimIntPay canônico para exceções HTTP (sem vazar token). */
  private canonicalError(error: unknown, action: string): never {
    if (error instanceof SimintpayPlatformError) {
      if (error.status === 400 || error.status === 409 || error.status === 422) {
        throw new BadRequestException(`${action}: ${error.body.slice(0, 300)}`);
      }
      throw new ServiceUnavailableException(`${action}: SimIntPay respondeu ${error.status}`);
    }
    throw new ServiceUnavailableException(`${action}: SimIntPay indisponível`);
  }

  private async canonicalSummary(cpf: string) {
    try {
      // Saldo já escopado à plataforma EBOOK; taxas reais (taxa alvo, saque mínimo) vêm de finance/fees.
      const [summary, fees] = await Promise.all([merchantSummary(cpf), merchantFees(cpf)]);
      return mapCanonicalSummary(summary, fees);
    } catch (error) {
      if (isMerchantNotAssociated(error) || isMerchantWithoutAccount(error)) {
        // Vendedor não provisionado: accountExists:false mantém o saldo estimado local; taxas pela config da plataforma.
        const config = await platformFinanceConfig().catch(() => null);
        return mapPlatformConfigFallback(config);
      }
      this.canonicalError(error, 'Falha ao consultar saldo');
    }
  }

  /**
   * Transações no formato legado `{ transactions }` (R$). Canônico: máx. 200 por página, então pagina até `limit`.
   * `PAID` deve chegar aqui já como `COMPLETED`.
   */
  private async machineTransactions(
    cpf: string,
    query: { limit: number; startDate?: string; endDate?: string; status?: string; description?: string },
  ): Promise<{ transactions: any[] }> {
    const pageSize = Math.min(200, query.limit);
    const transactions: any[] = [];
    try {
      for (let page = 1; transactions.length < query.limit; page++) {
        const result = await merchantTransactions(cpf, { ...query, page, limit: pageSize });
        transactions.push(...result.data.map(mapCanonicalTransaction));
        if (page >= result.meta.totalPages) break;
      }
    } catch (error) {
      if (isMerchantNotAssociated(error) || isMerchantWithoutAccount(error)) return { transactions: [] };
      this.canonicalError(error, 'Falha ao consultar transações');
    }
    return { transactions: transactions.slice(0, query.limit) };
  }

  @Get('summary')
  async summary(@GetUser() user: RequestWithUser['user']) {
    const cpf = await this.getCpfFromUser(user);
    const machineSummary = await this.canonicalSummary(cpf);

    // Sem conta ativa no Simintpay: gateway não tem onde guardar saldo.
    // Calcula um saldo estimado a partir dos pedidos pagos localmente, só para exibição —
    // saque continua bloqueado até a conta ser criada lá.
    if (machineSummary?.accountExists !== true) {
      const paidOrders = await this.prisma.order.findMany({
        where: {
          store: 'ebook',
          notes: { contains: this.ownerTag(cpf) },
          AND: [{ status: 'paid' }, { paymentStatus: 'paid' }],
        },
        select: { netAmount: true, totalAmount: true },
      });
      const sellerFees = parseSellerFees(machineSummary) ?? (await getSellerFees(cpf));
      const estimatedBalance = paidOrders.reduce((sum, o) => sum + this.localNetAmount(o, sellerFees), 0);
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

    const mergedSorted = await this.listSellerTransactions({ cpf, startDate, endDate, status, description });
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

  /**
   * Números do Dashboard calculados da mesma fonte dos Relatórios (listSellerTransactions),
   * para os dois sempre baterem.
   */
  @Get('dashboard-stats')
  async dashboardStats(@GetUser() user: RequestWithUser['user']) {
    const cpf = await this.getCpfFromUser(user);
    const transactions = await this.listSellerTransactions({ cpf });

    const PAID_STATUSES = new Set(['PAID', 'COMPLETED', 'APPROVED']);
    const paid = transactions.filter((tx) => PAID_STATUSES.has(String(tx.status || '').toUpperCase()));

    const monthKey = (value: Date | string) =>
      new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' })
        .format(new Date(value));
    const currentMonth = monthKey(new Date());
    const paidThisMonth = paid.filter((tx) => tx.createdAt && monthKey(tx.createdAt) === currentMonth);

    const sumAmount = (txs: any[]) => Number(txs.reduce((sum, tx) => sum + Number(tx.amount || 0), 0).toFixed(2));

    // Título do livro: pelo pedido local (orderNumber na descrição); senão, a própria descrição limpa
    const orderNumberOf = (tx: any): string | null => {
      const fromPaymentId = String(tx.paymentId || '').match(/^ORDER:(.+)$/);
      if (fromPaymentId) return fromPaymentId[1];
      const fromDescription = String(tx.description || '').match(/\b((?:ORD|FREE|MOCK)-[A-Z0-9-]+)/i);
      return fromDescription ? fromDescription[1] : null;
    };
    const orderNumbers = [...new Set(paid.map(orderNumberOf).filter((n): n is string => !!n))];
    const orders = orderNumbers.length
      ? await this.prisma.order.findMany({
          where: { orderNumber: { in: orderNumbers } },
          select: {
            orderNumber: true,
            orderItems: { select: { book: { select: { title: true, price: true } } }, take: 1 },
          },
        })
      : [];
    const bookByOrder = new Map(orders.map((o) => [o.orderNumber, o.orderItems[0]?.book]));

    const cleanDescription = (text: string) =>
      String(text || '')
        .replace(/\[[A-Z_]+:[^\]]*\]/gi, '')
        .replace(/^\s*Pedido\s+\S+\s*-\s*/i, '')
        .trim() || 'Sem título';

    const bookSales = new Map<string, { title: string; quantity: number; price: number }>();
    for (const tx of paid) {
      const orderNumber = orderNumberOf(tx);
      const book = orderNumber ? bookByOrder.get(orderNumber) : undefined;
      const title = book?.title || cleanDescription(tx.description);
      const key = title.toLowerCase();
      const entry = bookSales.get(key) ?? { title, quantity: 0, price: Number(book?.price ?? tx.amount ?? 0) };
      entry.quantity += 1;
      bookSales.set(key, entry);
    }
    const bestSelling = [...bookSales.values()].sort((a, b) => b.quantity - a.quantity)[0];

    // transactions já vem ordenado do mais recente para o mais antigo
    const lastSale = paid[0];

    return {
      totalRevenue: sumAmount(paid),
      totalSales: paid.length,
      currentMonthRevenue: sumAmount(paidThisMonth),
      currentMonthSales: paidThisMonth.length,
      lastSaleDate: lastSale?.createdAt ? new Date(lastSale.createdAt).toISOString() : null,
      bestSellingBook: bestSelling?.title ?? 'Nenhum',
      bestSellingBookQuantity: bestSelling?.quantity ?? 0,
      bestSellingBookPrice: bestSelling?.price ?? 0,
    };
  }

  @Get('withdrawals')
  async withdrawals(
    @GetUser() user: RequestWithUser['user'],
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const cpf = await this.getCpfFromUser(user);
    try {
      const result = await merchantWithdrawals(
        cpf,
        Math.max(1, Number(page || 1)),
        Math.min(Math.max(1, Number(limit || 10)), 100), // canônico limita a 100 por página
      );
      const dbUser = await this.prisma.user.findUnique({ where: { id: user.id }, select: { name: true, email: true } });
      return mapCanonicalWithdrawals(result, { id: user.id, ...dbUser });
    } catch (error) {
      if (isMerchantNotAssociated(error) || isMerchantWithoutAccount(error)) {
        return { withdrawals: [], meta: { currentPage: 1, itemsPerPage: 10, totalItems: 0, totalPages: 1 } };
      }
      this.canonicalError(error, 'Falha ao listar saques');
    }
  }

  @Post('withdraw')
  @ApiOperation({ summary: 'Solicitar saque' })
  async withdraw(
    @GetUser() user: RequestWithUser['user'],
    @Body() body: WithdrawRequestDto,
    @Headers('idempotency-key') idempotencyHeader?: string,
  ) {
    if (!body.amount || isNaN(Number(body.amount)) || body.amount <= 0) {
      throw new BadRequestException('Valor de saque inválido ou não informado.');
    }
    if (!body.pixKey) {
      throw new BadRequestException('Chave PIX é obrigatória.');
    }

    const cpf = await this.getCpfFromUser(user);
    return this.canonicalWithdraw(user, cpf, body, idempotencyHeader);
  }

  /**
   * Cotação do saque (antes de confirmar): `amount` é o valor BRUTO retirado do saldo; a taxa é subtraída.
   * Resposta em R$: { grossAmount, fee, netAmount, minimumWithdrawalAmount }.
   */
  @Post('withdraw/quote')
  @ApiOperation({ summary: 'Cotar saque (bruto, taxa e líquido)' })
  async withdrawQuote(@GetUser() user: RequestWithUser['user'], @Body() body: { amount: number }) {
    const grossCents = Math.round(Number(body?.amount) * 100);
    if (!Number.isSafeInteger(grossCents) || grossCents <= 0) {
      throw new BadRequestException('Valor de saque inválido ou não informado.');
    }
    const cpf = await this.getCpfFromUser(user);
    try {
      const [quote, fees] = await Promise.all([merchantQuote(cpf, grossCents), merchantFees(cpf)]);
      return mapWithdrawalQuote(quote, fees);
    } catch (error) {
      this.canonicalError(error, 'Falha ao cotar saque');
    }
  }

  /**
   * Saque canônico. `amount` é o valor BRUTO (a taxa é subtraída; o vendedor recebe o líquido, que o histórico mostra).
   * Valida o mínimo com finance/fees e confere a taxa com /withdrawals/quote antes de enviar.
   */
  private async canonicalWithdraw(
    user: RequestWithUser['user'],
    cpf: string,
    body: WithdrawRequestDto,
    idempotencyHeader?: string,
  ) {
    const grossCents = Math.round(Number(body.amount) * 100);
    try {
      const [quote, fees] = await Promise.all([merchantQuote(cpf, grossCents), merchantFees(cpf)]);
      if (grossCents < fees.withdrawal.minimumCents) {
        throw new BadRequestException(`Valor mínimo para saque é de R$ ${(fees.withdrawal.minimumCents / 100).toFixed(2)}`);
      }
      const idempotencyKey = withdrawalIdempotencyKey({
        userId: user.id,
        grossCents,
        pixKey: body.pixKey,
        clientKey: body.idempotencyKey ?? idempotencyHeader,
      });
      const result = await merchantWithdraw(cpf, { amountCents: grossCents, pixKey: body.pixKey.trim(), idempotencyKey });
      const r = result as any;
      return {
        success: true,
        id: result.id,
        status: result.status,
        grossAmount: Number(((r.grossAmountCents ?? quote.grossAmountCents) / 100).toFixed(2)),
        fee: Number(((r.feeCents ?? quote.feeCents) / 100).toFixed(2)),
        amount: Number(((r.amountCents ?? quote.netAmountCents) / 100).toFixed(2)),
      };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      if (isMerchantNotAssociated(error)) {
        throw new BadRequestException('Nenhuma conta encontrada para este CPF');
      }
      if (error instanceof Error && !(error instanceof SimintpayPlatformError) && /idempotencyKey/.test(error.message)) {
        throw new BadRequestException(error.message);
      }
      this.canonicalError(error, 'Falha ao solicitar saque');
    }
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
    const data = await this.machineTransactions(cpf, {
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

    const data = await this.machineTransactions(cpf, {
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

