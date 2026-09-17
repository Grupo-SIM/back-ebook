import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { randomBytes } from 'crypto';
import { AffiliateMeResponseDto, AffiliateCommissionResponseDto, PaginatedAffiliateCommissionResponseDto, AffiliateQueryDto } from './dto/affiliate.dto';

@Injectable()
export class AffiliateService {
    private readonly logger = new Logger(AffiliateService.name);

    constructor(private readonly prisma: PrismaService) { }

    private _rateCache: number | null = null;
    private _rateCacheFetchedAt = 0;

    private getApiMachineBaseUrl(): string | null {
        const base = process.env.API_MACHINE_URL || process.env.API_MACHINE_INTERNAL_URL || null;
        if (!base) return null;
        return base.replace(/\/+$/, '');
    }

    private getInternalToken(): string | undefined {
        return process.env.API_MACHINE_INTERNAL_TOKEN || process.env.INTERNAL_SERVICE_TOKEN;
    }

    /**
     * Taxa de comissão de afiliado (%). Busca da aba Taxas do simintpay
     * (config global do produto ebooksim, editável pelo master), com cache de 30s
     * e fallback pra env var local caso o simintpay esteja indisponível.
     */
    async getCommissionRate(): Promise<number> {
        const now = Date.now();
        if (this._rateCache !== null && now - this._rateCacheFetchedAt < 30 * 1000) {
            return this._rateCache;
        }
        const base = this.getApiMachineBaseUrl();
        const token = this.getInternalToken();
        if (base && token) {
            try {
                const res = await fetch(`${base}/internal/ebook/finance/config`, {
                    headers: { 'x-internal-token': token },
                });
                if (res.ok) {
                    const body = (await res.json()) as { affiliateCommissionRate?: number };
                    const v = body?.affiliateCommissionRate;
                    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
                        this._rateCache = v;
                        this._rateCacheFetchedAt = now;
                        return v;
                    }
                }
            } catch {
                // fallback abaixo
            }
        }
        const fallback = parseFloat(process.env.AFFILIATE_COMMISSION_RATE ?? '10');
        const rate = Number.isFinite(fallback) && fallback >= 0 ? fallback : 10;
        this._rateCache = rate;
        this._rateCacheFetchedAt = now;
        return rate;
    }

    /**
     * Credita a comissão como saldo sacável real na conta do afiliado no simintpay
     * (cria uma transação COMPLETED lá, vinculada por CPF/CNPJ). Não bloqueia o
     * fluxo principal em caso de falha — o registro local em AffiliateCommission
     * já serve de fonte de verdade e pode ser reprocessado depois.
     */
    private async creditOnSimintpay(params: {
        referenceId: string;
        cpf?: string | null;
        cnpj?: string | null;
        amount: number;
        description: string;
    }): Promise<void> {
        const base = this.getApiMachineBaseUrl();
        const token = this.getInternalToken();
        if (!base || !token) return;
        const doc = params.cnpj || params.cpf;
        if (!doc) {
            this.logger.warn(`[Affiliate] Afiliado sem CPF/CNPJ cadastrado — comissão ${params.referenceId} não creditada no simintpay`);
            return;
        }
        try {
            const res = await fetch(`${base}/internal/ebook/finance/credit-commission`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-internal-token': token },
                body: JSON.stringify({
                    referenceId: params.referenceId,
                    cpf: params.cpf ?? undefined,
                    cnpj: params.cnpj ?? undefined,
                    amount: params.amount,
                    description: params.description,
                }),
            });
            if (!res.ok) {
                const text = await res.text().catch(() => '');
                this.logger.error(`[Affiliate] simintpay recusou crédito de comissão ${params.referenceId}: ${res.status} ${text}`);
            }
        } catch (err: any) {
            this.logger.error(`[Affiliate] Falha ao chamar simintpay para creditar comissão ${params.referenceId}: ${err?.message}`);
        }
    }

    private generateCode(): string {
        return randomBytes(4).toString('hex').toUpperCase();
    }

    /**
     * Retorna (e gera se necessário) o código de afiliado do admin autenticado.
     */
    async ensureAffiliateCode(userId: string): Promise<string> {
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (user?.affiliateCode) return user.affiliateCode;

        // Retry em caso de colisão improvável do código único
        for (let attempt = 0; attempt < 5; attempt++) {
            const code = this.generateCode();
            try {
                const updated = await this.prisma.user.update({
                    where: { id: userId },
                    data: { affiliateCode: code },
                });
                return updated.affiliateCode as string;
            } catch {
                continue;
            }
        }
        throw new Error('Não foi possível gerar código de afiliado');
    }

    async getMe(userId: string): Promise<AffiliateMeResponseDto> {
        const affiliateCode = await this.ensureAffiliateCode(userId);

        const commissions = await this.prisma.affiliateCommission.findMany({
            where: { affiliateId: userId },
        });

        const totalCredited = commissions
            .filter((c) => c.status === 'CREDITED')
            .reduce((sum, c) => sum + c.commissionAmount, 0);
        const totalEarned = commissions
            .filter((c) => c.status !== 'REVERSED')
            .reduce((sum, c) => sum + c.commissionAmount, 0);

        // Link deve apontar para a loja (front-ebook), nunca para esta API (URL_APP)
        const storeUrl = process.env.EBOOK_STORE_URL || process.env.STORE_URL || 'https://ebooksim.com';

        return {
            affiliateCode,
            affiliateLink: `${storeUrl}?ref=${affiliateCode}`,
            commissionRate: await this.getCommissionRate(),
            totalEarned: parseFloat(totalEarned.toFixed(2)),
            totalCredited: parseFloat(totalCredited.toFixed(2)),
            salesCount: commissions.filter((c) => c.status !== 'REVERSED').length,
        };
    }

    async getMyCommissions(userId: string, query: AffiliateQueryDto): Promise<PaginatedAffiliateCommissionResponseDto> {
        const page = Number(query.page) || 1;
        const limit = Number(query.limit) || 10;
        const skip = (page - 1) * limit;

        const [rows, total] = await Promise.all([
            this.prisma.affiliateCommission.findMany({
                where: { affiliateId: userId },
                include: { book: { select: { title: true } } },
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit,
            }),
            this.prisma.affiliateCommission.count({ where: { affiliateId: userId } }),
        ]);

        const data: AffiliateCommissionResponseDto[] = rows.map((r) => ({
            id: r.id,
            bookId: r.bookId,
            bookTitle: r.book.title,
            orderId: r.orderId,
            orderNumber: r.orderNumber,
            grossAmount: r.grossAmount,
            commissionRate: r.commissionRate,
            commissionAmount: r.commissionAmount,
            status: r.status,
            createdAt: r.createdAt,
        }));

        return {
            data,
            page,
            limit,
            total,
            totalPages: Math.max(1, Math.ceil(total / limit)),
        };
    }

    /**
     * Credita comissão de afiliado para um pedido pago, um item (livro afiliado) por vez.
     * Chamado a partir do fluxo de confirmação de pagamento (webhook).
     * Idempotente: usa a unique constraint (orderId, bookId) como trava.
     */
    async creditCommissionForOrder(order: {
        id: number;
        orderNumber: string;
        affiliateCode: string | null;
        orderItems: Array<{ bookId: number; totalPrice: number; book: { isAffiliate: boolean; createdById: string | null; title?: string } }>;
    }): Promise<void> {
        if (!order.affiliateCode) return;

        const affiliate = await this.prisma.user.findUnique({ where: { affiliateCode: order.affiliateCode } });
        if (!affiliate) {
            this.logger.warn(`[Affiliate] Código "${order.affiliateCode}" do pedido ${order.orderNumber} não corresponde a nenhum afiliado`);
            return;
        }

        const rate = await this.getCommissionRate();
        if (rate <= 0) return;

        for (const item of order.orderItems) {
            if (!item.book?.isAffiliate) continue;
            // Afiliado não ganha comissão vendendo o próprio livro
            if (item.book.createdById === affiliate.id) continue;

            const grossAmount = item.totalPrice;
            const commissionAmount = parseFloat(((grossAmount * rate) / 100).toFixed(2));
            if (commissionAmount <= 0) continue;

            try {
                await this.prisma.affiliateCommission.create({
                    data: {
                        affiliateId: affiliate.id,
                        bookId: item.bookId,
                        orderId: order.id,
                        orderNumber: order.orderNumber,
                        grossAmount,
                        commissionRate: rate,
                        commissionAmount,
                        status: 'CREDITED',
                    },
                });
                this.logger.log(`[Affiliate] Comissão creditada: afiliado=${affiliate.id} livro=${item.bookId} pedido=${order.orderNumber} valor=${commissionAmount}`);

                await this.creditOnSimintpay({
                    referenceId: `${order.id}-${item.bookId}`,
                    cpf: affiliate.cpf,
                    cnpj: affiliate.cnpj,
                    amount: commissionAmount,
                    description: `Comissão de afiliado — ${item.book.title ?? `livro #${item.bookId}`} (pedido ${order.orderNumber})`,
                });
            } catch (err: any) {
                // Unique constraint (orderId, bookId) -> já processado, ignora
                if (err?.code !== 'P2002') {
                    this.logger.error(`[Affiliate] Falha ao creditar comissão do pedido ${order.orderNumber}: ${err?.message}`);
                }
            }
        }
    }

    /**
     * Reverte comissões de um pedido cancelado/estornado.
     */
    async reverseCommissionsForOrder(orderId: number): Promise<void> {
        await this.prisma.affiliateCommission.updateMany({
            where: { orderId, status: 'CREDITED' },
            data: { status: 'REVERSED', reversedAt: new Date() },
        });
    }
}
