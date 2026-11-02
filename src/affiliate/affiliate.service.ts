import { retryCommissionDeliveries } from './commission-delivery';
import { validateCommissionEvidence } from './commission-evidence';
import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { randomBytes } from 'crypto';
import {
    AffiliateMeResponseDto,
    AffiliateCommissionResponseDto,
    PaginatedAffiliateCommissionResponseDto,
    AffiliateQueryDto,
    AffiliateMarketplaceQueryDto,
    AffiliateMarketplaceBookResponseDto,
    PaginatedAffiliateMarketplaceBookResponseDto,
    AffiliateProductLinkResponseDto,
    AffiliateFavoriteBookResponseDto,
    PaginatedAffiliateFavoriteResponseDto,
} from './dto/affiliate.dto';

@Injectable()
export class AffiliateService {
    private readonly logger = new Logger(AffiliateService.name);

    private retryTimer?: ReturnType<typeof setInterval>;
    private retryRunning = false;

    constructor(private readonly prisma: PrismaService) { }

    onModuleInit(): void {
        this.retryTimer = setInterval(() => {
            if (this.retryRunning) return;
            this.retryRunning = true;
            void this.retryCommissionDeliveries().catch(() => {
                this.logger.error('[Affiliate] Durable delivery retry failed');
            }).finally(() => { this.retryRunning = false; });
        }, 60_000);
        this.retryTimer.unref();
    }

    onModuleDestroy(): void {
        if (this.retryTimer) clearInterval(this.retryTimer);
    }

    async retryCommissionDeliveries(limit = 20): Promise<void> {
        await retryCommissionDeliveries(this.prisma, limit);
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
            totalEarned: parseFloat(totalEarned.toFixed(2)),
            totalCredited: parseFloat(totalCredited.toFixed(2)),
            salesCount: commissions.filter((c) => c.status !== 'REVERSED').length,
        };
    }

    async getMyCommissions(userId: string, query: AffiliateQueryDto): Promise<PaginatedAffiliateCommissionResponseDto> {
        const page = Number(query.page) || 1;
        const limit = Number(query.limit) || 10;
        const skip = (page - 1) * limit;

        // Traz tanto comissões que o admin GANHOU (vendeu livro de outro admin)
        // quanto comissões que outros admins ganharam vendendo um livro DELE.
        const where = {
            OR: [
                { affiliateId: userId },
                { book: { createdById: userId } },
            ],
        };

        const [rows, total] = await Promise.all([
            this.prisma.affiliateCommission.findMany({
                where,
                include: {
                    book: { select: { title: true } },
                    affiliate: { select: { name: true } },
                },
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit,
            }),
            this.prisma.affiliateCommission.count({ where }),
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
            isMine: r.affiliateId === userId,
            affiliateName: r.affiliate?.name ?? null,
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
     * Cada item resolve seu próprio afiliado via o link de afiliado-por-produto usado
     * na compra daquele item (não mais um único código para o pedido inteiro).
     * Chamado a partir do fluxo de confirmação de pagamento (webhook).
     * Idempotente: usa a unique constraint (orderId, bookId) como trava.
     */
    async creditCommissionForOrder(order: {
        id: number;
        orderNumber: string;
        userId?: string;
        orderItems: Array<{
            bookId: number;
            totalPrice: number;
            affiliateProductLink: { affiliateId: string; code: string } | null;
            book: { isAffiliate: boolean; createdById: string | null; title?: string; commissionRate?: number | null };
        }>;
    }): Promise<void> {
        console.log('[affiliate][creditCommissionForOrder] pedido', order.orderNumber, 'itens:', JSON.stringify(order.orderItems.map(i => ({ bookId: i.bookId, link: i.affiliateProductLink, isAffiliate: i.book?.isAffiliate }))));

        for (const item of order.orderItems) {
            const link = item.affiliateProductLink;
            if (!link || !item.book?.isAffiliate) continue;

            const rate = item.book.commissionRate;
            if (!rate || rate <= 0) continue;

            // Afiliado não ganha comissão comprando com o próprio link (autocompra)
            if (order.userId && order.userId === link.affiliateId) continue;

            // Afiliado não pode ser o dono do livro (defesa extra: o link pode ter sido
            // criado antes do livro trocar de dono)
            if (item.book.createdById && item.book.createdById === link.affiliateId) continue;

            const affiliate = await this.prisma.user.findUnique({ where: { id: link.affiliateId } });
            if (!affiliate) {
                this.logger.warn(`[Affiliate] Link "${link.code}" do pedido ${order.orderNumber} não corresponde a nenhum afiliado`);
                continue;
            }

            const grossAmount = item.totalPrice;
            const commissionAmount = parseFloat(((grossAmount * rate) / 100).toFixed(2));
            if (commissionAmount <= 0) continue;

            try {
                await this.prisma.$transaction(async tx => {
                const orderItems = await tx.orderItem.findMany({
                    where: { orderId: order.id, bookId: item.bookId },
                    select: { id: true, orderId: true, bookId: true, quantity: true, unitPrice: true, totalPrice: true,
                        order: { select: { orderNumber: true } },
                        book: { select: { createdById: true } },
                        affiliateProductLink: { select: { affiliateId: true, code: true } } },
                    orderBy: { id: 'asc' },
                });
                const evidence = validateCommissionEvidence(orderItems, {
                    orderId: order.id, orderNumber: order.orderNumber, bookId: item.bookId,
                    sellerId: item.book.createdById, affiliateId: affiliate.id, code: link.code, grossAmount, commissionAmount,
                });
                const snapshot = JSON.stringify({
                    ...evidence,
                    referenceId: `${order.id}-${item.bookId}`, orderId: order.id,
                    orderNumber: order.orderNumber, bookId: item.bookId,
                    sellerId: item.book.createdById || null, affiliateId: affiliate.id,
                    cpf: affiliate.cpf || null, cnpj: affiliate.cnpj || null,
                    amount: commissionAmount, currency: 'BRL', grossAmount, commissionRate: rate,
                    description: `Comissão de afiliado — ${item.book.title ?? `livro #${item.bookId}`} (pedido ${order.orderNumber})`,
                    fundingRule: 'SELLER_FUNDED_GROSS_COMMISSION',
                    serviceFeeRule: 'ONCE_PER_ORDER_PROPORTIONAL_ITEM_GROSS_DETERMINISTIC_CENTS',
                    coproductionOrdering: 'UNRESOLVED',
                });
                    const commission = await tx.affiliateCommission.create({ data: {
                        affiliateId: affiliate.id, bookId: item.bookId, orderId: order.id,
                        orderNumber: order.orderNumber, grossAmount, commissionRate: rate,
                        commissionAmount, status: 'CREDITED',
                    } });
                    await tx.$executeRaw`INSERT INTO affiliate_commission_deliveries
                        (commission_id, state, snapshot) VALUES (${commission.id}, 'PENDING', ${snapshot}::jsonb)`;
                });
            } catch (err: any) {
                // Unique constraint (orderId, bookId) -> já processado, ignora
                if (err?.code !== 'P2002') {
                    this.logger.error(`[Affiliate] Falha ao creditar comissão do pedido ${order.orderNumber}: ${err?.message}`);
                }
            }
        }
        await this.retryCommissionDeliveries();
    }

    /**
     * Lista livros de OUTROS admins que participam do programa de afiliados
     * (marketplace de afiliados), indicando se o admin autenticado já tem
     * um link próprio gerado para cada um.
     */
    async getMarketplaceBooks(
        affiliateId: string,
        query: AffiliateMarketplaceQueryDto,
    ): Promise<PaginatedAffiliateMarketplaceBookResponseDto> {
        const page = Number(query.page) || 1;
        const limit = Number(query.limit) || 10;
        const skip = (page - 1) * limit;

        const where = {
            isAffiliate: true,
            isActive: true,
            createdById: { not: affiliateId },
            ...(query.search ? { title: { contains: query.search, mode: 'insensitive' as const } } : {}),
            ...(query.category && query.category !== 'all' ? { category: query.category } : {}),
        };

        const orderBy = this.mapSortOptionToOrderBy(query.sortOption);

        const [books, total] = await Promise.all([
            this.prisma.book.findMany({
                where,
                include: { createdBy: { select: { name: true } } },
                orderBy,
                skip,
                take: limit,
            }),
            this.prisma.book.count({ where }),
        ]);

        const bookIds = books.map((b) => b.id);
        const [existingLinks, favorites] = await Promise.all([
            bookIds.length
                ? this.prisma.affiliateProductLink.findMany({
                    where: { affiliateId, bookId: { in: bookIds } },
                })
                : Promise.resolve([]),
            bookIds.length
                ? this.prisma.affiliateFavorite.findMany({
                    where: { affiliateId, bookId: { in: bookIds } },
                })
                : Promise.resolve([]),
        ]);
        const linkByBookId = new Map(existingLinks.map((l) => [l.bookId, l]));
        const favoriteBookIds = new Set(favorites.map((f) => f.bookId));
        const storeUrl = process.env.EBOOK_STORE_URL || process.env.STORE_URL || 'https://ebooksim.com';

        const data: AffiliateMarketplaceBookResponseDto[] = books.map((book) => {
            const link = linkByBookId.get(book.id);
            return {
                bookId: book.id,
                title: book.title,
                author: book.author,
                cover: book.cover,
                category: book.category,
                price: book.price,
                ownerName: book.createdBy?.name ?? null,
                commissionRate: (book as any).commissionRate ?? 0,
                hasLink: Boolean(link),
                productLink: link
                    ? { code: link.code, link: `${storeUrl}/book/${book.id}?refp=${link.code}` }
                    : null,
                isFavorite: favoriteBookIds.has(book.id),
            };
        });

        return {
            data,
            page,
            limit,
            total,
            totalPages: Math.max(1, Math.ceil(total / limit)),
        };
    }

    private mapSortOptionToOrderBy(sortOption?: string) {
        switch (sortOption) {
            case 'bestsellers':
                return { sales: 'desc' as const };
            case 'toprated':
                return { rating: 'desc' as const };
            case 'price-low':
                return { price: 'asc' as const };
            case 'price-high':
                return { price: 'desc' as const };
            default:
                return { createdAt: 'desc' as const };
        }
    }

    /**
     * Lista as categorias distintas entre os livros disponíveis para afiliação
     * (isAffiliate=true de outros admins), para alimentar o filtro do marketplace.
     */
    async getMarketplaceCategories(affiliateId: string): Promise<string[]> {
        const rows = await this.prisma.book.findMany({
            where: { isAffiliate: true, isActive: true, createdById: { not: affiliateId } },
            select: { category: true },
            distinct: ['category'],
            orderBy: { category: 'asc' },
        });
        return rows.map((r) => r.category).filter(Boolean);
    }

    /**
     * Gera (ou retorna, se já existir) o link único de afiliado do admin
     * autenticado para um livro específico. Idempotente por (bookId, affiliateId).
     */
    async ensureProductLink(affiliateId: string, bookId: number): Promise<AffiliateProductLinkResponseDto> {
        const book = await this.prisma.book.findUnique({ where: { id: bookId } });
        if (!book) throw new NotFoundException('Livro não encontrado');
        if (!book.isAffiliate) throw new BadRequestException('Livro não participa do programa de afiliados');
        if (book.createdById === affiliateId) {
            throw new BadRequestException('Você não pode gerar link de afiliado para o seu próprio livro');
        }

        const existing = await this.prisma.affiliateProductLink.findUnique({
            where: { bookId_affiliateId: { bookId, affiliateId } },
        });
        if (existing) return this.mapProductLink(existing);

        for (let attempt = 0; attempt < 5; attempt++) {
            const code = this.generateCode();
            try {
                const created = await this.prisma.affiliateProductLink.create({
                    data: { bookId, affiliateId, code },
                });
                return this.mapProductLink(created);
            } catch (err: any) {
                if (err?.code === 'P2002') continue;
                throw err;
            }
        }
        throw new Error('Não foi possível gerar link de afiliado');
    }

    private mapProductLink(link: { bookId: number; code: string; createdAt: Date }): AffiliateProductLinkResponseDto {
        const storeUrl = process.env.EBOOK_STORE_URL || process.env.STORE_URL || 'https://ebooksim.com';
        return {
            bookId: link.bookId,
            code: link.code,
            link: `${storeUrl}/book/${link.bookId}?refp=${link.code}`,
            createdAt: link.createdAt,
        };
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

    /**
     * Favorita um livro do marketplace de afiliados. Idempotente.
     */
    async addFavorite(affiliateId: string, bookId: number): Promise<{ isFavorite: boolean }> {
        const book = await this.prisma.book.findUnique({ where: { id: bookId } });
        if (!book) throw new NotFoundException('Livro não encontrado');
        if (!book.isAffiliate) throw new BadRequestException('Livro não participa do programa de afiliados');

        try {
            await this.prisma.affiliateFavorite.create({ data: { affiliateId, bookId } });
        } catch (err: any) {
            if (err?.code !== 'P2002') throw err; // já favoritado, ignora
        }
        return { isFavorite: true };
    }

    /**
     * Remove um livro dos favoritos do afiliado autenticado.
     */
    async removeFavorite(affiliateId: string, bookId: number): Promise<{ isFavorite: boolean }> {
        await this.prisma.affiliateFavorite.deleteMany({ where: { affiliateId, bookId } });
        return { isFavorite: false };
    }

    /**
     * Lista os livros favoritados pelo afiliado autenticado (mesmo formato do marketplace).
     */
    async getMyFavorites(affiliateId: string, query: AffiliateQueryDto): Promise<PaginatedAffiliateFavoriteResponseDto> {
        const page = Number(query.page) || 1;
        const limit = Number(query.limit) || 10;
        const skip = (page - 1) * limit;

        const where = { affiliateId };

        const [favorites, total] = await Promise.all([
            this.prisma.affiliateFavorite.findMany({
                where,
                include: {
                    book: { include: { createdBy: { select: { name: true } } } },
                },
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit,
            }),
            this.prisma.affiliateFavorite.count({ where }),
        ]);

        const bookIds = favorites.map((f) => f.bookId);
        const existingLinks = bookIds.length
            ? await this.prisma.affiliateProductLink.findMany({
                where: { affiliateId, bookId: { in: bookIds } },
            })
            : [];
        const linkByBookId = new Map(existingLinks.map((l) => [l.bookId, l]));
        const storeUrl = process.env.EBOOK_STORE_URL || process.env.STORE_URL || 'https://ebooksim.com';

        const data: AffiliateFavoriteBookResponseDto[] = favorites.map((f) => {
            const link = linkByBookId.get(f.bookId);
            return {
                bookId: f.book.id,
                title: f.book.title,
                author: f.book.author,
                cover: f.book.cover,
                category: f.book.category,
                price: f.book.price,
                ownerName: f.book.createdBy?.name ?? null,
                commissionRate: (f.book as any).commissionRate ?? 0,
                hasLink: Boolean(link),
                productLink: link
                    ? { code: link.code, link: `${storeUrl}/book/${f.book.id}?refp=${link.code}` }
                    : null,
            };
        });

        return {
            data,
            page,
            limit,
            total,
            totalPages: Math.max(1, Math.ceil(total / limit)),
        };
    }
}
