import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { RedisService } from 'src/redis.service';
import { NotificationService } from 'src/notification/notification.service';
import { AppService } from 'src/app.service';
import {
    CartItemDto,
    CheckoutItemDto,
    AddToCartDto,
    UpdateCartItemDto,
    SelectCartItemsDto,
    CreateOrderDto,
    OrderResponseDto,
    CheckoutStateDto,
    OrderQueryDto,
    OrderStatus,
    PaymentStatus,
    CheckoutStep,
    CartItem,
    CheckoutItem,
    CheckoutState
} from './dto/checkout.dto';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class CheckoutService {
    private static readonly PLATFORM_EBOOK_TAG = '[TENANT:EBOOK]';

    constructor(
        private readonly prisma: PrismaService,
        private readonly redisService: RedisService,
        private readonly notificationService: NotificationService,
        private readonly appService: AppService,
    ) { }

    private buildInternalCheckoutDescription(baseDescription: string, ownerCpf: string | null | undefined): string {
        const cpfDigits = String(ownerCpf ?? '').replace(/\D/g, '');
        if (cpfDigits.length !== 11) return baseDescription;
        return `${baseDescription} ${CheckoutService.PLATFORM_EBOOK_TAG} [CPF_DONO:${cpfDigits}]`;
    }

    // Carrinho
    async addToCart(userId: string, data: AddToCartDto): Promise<CheckoutItem> {
        // Verificar se o livro existe
        const book = await this.prisma.book.findUnique({
            where: { id: data.bookId }
        });

        if (!book) {
            throw new NotFoundException('Livro não encontrado');
        }

        // Verificar se já existe no carrinho
        const existingCartItem = await this.prisma.cart.findUnique({
            where: {
                userId_bookId: {
                    userId,
                    bookId: data.bookId
                }
            }
        });

        if (existingCartItem) {
            // Atualizar quantidade
            const updatedCartItem = await this.prisma.cart.update({
                where: { id: existingCartItem.id },
                data: {
                    quantity: existingCartItem.quantity + data.quantity
                },
                include: {
                    book: true
                }
            });

            await this.invalidateCartCache(userId);

            return {
                id: updatedCartItem.id,
                bookId: updatedCartItem.bookId,
                bookTitle: updatedCartItem.book.title,
                bookAuthor: updatedCartItem.book.author,
                bookPrice: updatedCartItem.book.price,
                bookOriginalPrice: updatedCartItem.book.originalPrice,
                bookCover: updatedCartItem.book.cover,
                quantity: updatedCartItem.quantity,
                selected: updatedCartItem.selected,
                totalPrice: updatedCartItem.book.price * updatedCartItem.quantity
            } as CheckoutItem;
        }

        // Adicionar novo item
        const newCartItem = await this.prisma.cart.create({
            data: {
                userId,
                bookId: data.bookId,
                quantity: data.quantity,
                selected: true
            },
            include: {
                book: true
            }
        });

        await this.invalidateCartCache(userId);

        // Enviar notificação de carrinho salvo
        await this.notificationService.notifyCartSaved(userId);

        return {
            id: newCartItem.id,
            bookId: newCartItem.bookId,
            bookTitle: newCartItem.book.title,
            bookAuthor: newCartItem.book.author,
            bookPrice: newCartItem.book.price,
            bookOriginalPrice: newCartItem.book.originalPrice,
            bookCover: newCartItem.book.cover,
            quantity: newCartItem.quantity,
            selected: newCartItem.selected,
            totalPrice: newCartItem.book.price * newCartItem.quantity
        } as CheckoutItem;
    }

    async getCart(userId: string): Promise<CheckoutItem[]> {
        const cacheKey = `cart:${userId}`;
        const cached = await this.redisService.get(cacheKey);

        if (cached) {
            return JSON.parse(cached);
        }

        const cartItems = await this.prisma.cart.findMany({
            where: { userId },
            include: {
                book: {
                    include: {
                        createdBy: {
                            select: { cpf: true }
                        }
                    }
                }
            },
            orderBy: { createdAt: 'desc' }
        });

        const cartItemsDto = cartItems.map(item => ({
            id: item.id,
            bookId: item.bookId,
            bookTitle: item.book.title,
            bookAuthor: item.book.author,
            bookPrice: item.book.price,
            bookOriginalPrice: item.book.originalPrice,
            bookCover: item.book.cover,
            quantity: item.quantity,
            selected: item.selected,
            totalPrice: item.book.price * item.quantity,
            checkoutUrl: `https://checkout.jbmidia.com/?value=${item.book.price}&description=${encodeURIComponent(this.buildInternalCheckoutDescription(item.book.title, item.book.createdBy?.cpf))}&store=ebook`
        } as CheckoutItem));

        await this.redisService.set(cacheKey, JSON.stringify(cartItemsDto), 300); // 5 minutos

        return cartItemsDto;
    }

    async updateCartItem(userId: string, cartItemId: number, data: UpdateCartItemDto): Promise<CheckoutItem> {
        const cartItem = await this.prisma.cart.findFirst({
            where: {
                id: cartItemId,
                userId
            },
            include: {
                book: true
            }
        });

        if (!cartItem) {
            throw new NotFoundException('Item do carrinho não encontrado');
        }

        const updatedCartItem = await this.prisma.cart.update({
            where: { id: cartItemId },
            data: {
                quantity: data.quantity,
                selected: data.selected
            },
            include: {
                book: true
            }
        });

        await this.invalidateCartCache(userId);

        return {
            id: updatedCartItem.id,
            bookId: updatedCartItem.bookId,
            bookTitle: updatedCartItem.book.title,
            bookAuthor: updatedCartItem.book.author,
            bookPrice: updatedCartItem.book.price,
            bookOriginalPrice: updatedCartItem.book.originalPrice,
            bookCover: updatedCartItem.book.cover,
            quantity: updatedCartItem.quantity,
            selected: updatedCartItem.selected,
            totalPrice: updatedCartItem.book.price * updatedCartItem.quantity
        } as CheckoutItem;
    }

    async removeFromCart(userId: string, cartItemId: number): Promise<void> {
        const cartItem = await this.prisma.cart.findFirst({
            where: {
                id: cartItemId,
                userId
            }
        });

        if (!cartItem) {
            throw new NotFoundException('Item do carrinho não encontrado');
        }

        await this.prisma.cart.delete({
            where: { id: cartItemId }
        });

        await this.invalidateCartCache(userId);
    }

    async clearCart(userId: string): Promise<void> {
        await this.prisma.cart.deleteMany({
            where: { userId }
        });

        await this.invalidateCartCache(userId);
    }

    async selectCartItems(userId: string, data: SelectCartItemsDto): Promise<CheckoutItem[]> {
        // Primeiro, desmarcar todos os itens
        await this.prisma.cart.updateMany({
            where: { userId },
            data: { selected: false }
        });

        // Depois, marcar apenas os selecionados
        if (data.selectedIds.length > 0) {
            await this.prisma.cart.updateMany({
                where: {
                    userId,
                    id: { in: data.selectedIds }
                },
                data: { selected: true }
            });
        }

        await this.invalidateCartCache(userId);

        return this.getCart(userId);
    }

    // Checkout
    async getCheckoutState(userId: string): Promise<CheckoutState> {
        const cartItems = await this.getCart(userId);

        const selectedItems = cartItems.filter(item => item.selected);
        const selectedItem = selectedItems.length > 0 ? selectedItems[0] : null;

        return {
            items: selectedItems,
            selectedItem,
            step: 'selection'
        };
    }

    // Pedidos
    async createOrder(userId: string, data: CreateOrderDto): Promise<OrderResponseDto & { checkoutUrl: string }> {
        // Verificar se os itens do carrinho existem e estão selecionados
        const cartItems = await this.prisma.cart.findMany({
            where: {
                userId,
                id: { in: data.cartItemIds },
                selected: true
            },
            include: {
                book: {
                    include: {
                        createdBy: true
                    }
                }
            }
        });

        if (cartItems.length === 0) {
            throw new BadRequestException('Nenhum item selecionado para o pedido');
        }

        // NOVA LÓGICA: Se todos os livros têm originalPrice, usar originalPrice como totalAmount, price como subtotal
        // Se não, usar price para ambos
        let subtotal = 0;
        let totalAmount = 0;
        for (const item of cartItems) {
            const price = item.book.price;
            const originalPrice = item.book.originalPrice;
            if (originalPrice && originalPrice > 0) {
                subtotal += price * item.quantity;
                totalAmount += originalPrice * item.quantity;
            } else {
                subtotal += price * item.quantity;
                totalAmount += price * item.quantity;
            }
        }
        const discount = 0; // Pode ser implementado com cupons
        // Gerar número do pedido
        const orderNumber = `ORD-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
        // Criar pedido
        const order = await this.prisma.order.create({
            data: {
                userId,
                orderNumber,
                status: 'pending' as OrderStatus,
                totalAmount,
                subtotal,
                discount,
                paymentStatus: 'pending' as PaymentStatus,
                store: 'ebook', // Sempre vem do ebook
            }
        });
        // Criar itens do pedido
        await Promise.all(
            cartItems.map(item =>
                this.prisma.orderItem.create({
                    data: {
                        orderId: order.id,
                        bookId: item.bookId,
                        quantity: item.quantity,
                        unitPrice: item.book.price,
                        totalPrice: item.book.price * item.quantity
                    }
                })
            )
        );
        // Remover itens do carrinho
        await this.prisma.cart.deleteMany({
            where: {
                userId,
                id: { in: data.cartItemIds }
            }
        });
        // Invalidar cache
        await this.invalidateCartCache(userId);
        await this.invalidateOrderCache(userId);
        // Buscar pedido completo
        const orderWithItems = await this.prisma.order.findUnique({
            where: { id: order.id },
            include: { orderItems: { include: { book: true } } },
        });
        const orderResponse = this.mapOrderToResponse(orderWithItems);

        // NOVA FUNCIONALIDADE: Identificar o token do admin que criou o livro
        let adminToken = null;
        if (cartItems.length > 0 && cartItems[0].book.createdById) {
            // Buscar o token do admin que criou o primeiro livro
            const adminTokenRecord = await this.prisma.$queryRaw`
                SELECT token FROM admin_tokens 
                WHERE "adminId" = ${cartItems[0].book.createdById} 
                AND "isActive" = true
            `;

            if (adminTokenRecord && Array.isArray(adminTokenRecord) && adminTokenRecord.length > 0) {
                adminToken = adminTokenRecord[0].token;
            }
        }

        // Gerar link de checkout com o token do admin se disponível
        const value = Math.round(orderResponse.totalAmount * 100); // valor em centavos
        const ownerCpfForDescription = cartItems[0]?.book.createdBy?.cpf;
        const description = encodeURIComponent(
            this.buildInternalCheckoutDescription(orderResponse.items[0]?.bookTitle || '', ownerCpfForDescription),
        );

        let checkoutUrl = `https://checkout.jbmidia.com/?value=${value}&description=${description}&store=ebook`;

        // Se temos o token do admin, adicionar ao URL
        if (adminToken) {
            checkoutUrl += `&adminToken=${encodeURIComponent(adminToken)}`;
        }

        return {
            ...orderResponse,
            checkoutUrl,
        };
    }

    async createOrderFromBook(userId: string, data: { bookId: number; quantity?: number }): Promise<OrderResponseDto & { checkoutUrl: string }> {
        // Buscar o livro
        const book = await this.prisma.book.findUnique({
            where: { id: data.bookId },
            include: { createdBy: true }
        });
        if (!book) {
            throw new NotFoundException('Livro não encontrado');
        }
        const quantity = data.quantity && data.quantity > 0 ? data.quantity : 1;
        // NOVA LÓGICA: se originalPrice existir, totalAmount = originalPrice * quantity, subtotal = price * quantity
        let subtotal = book.price * quantity;
        let totalAmount = book.price * quantity;
        if (book.originalPrice && book.originalPrice > 0) {
            totalAmount = book.originalPrice * quantity;
        }
        const discount = 0;
        const orderNumber = `ORD-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
        // Criar pedido
        const order = await this.prisma.order.create({
            data: {
                userId,
                orderNumber,
                status: 'pending',
                totalAmount,
                subtotal,
                discount,
                paymentStatus: 'pending',
                store: 'ebook', // Sempre vem do ebook
            }
        });
        // Criar item do pedido
        await this.prisma.orderItem.create({
            data: {
                orderId: order.id,
                bookId: book.id,
                quantity,
                unitPrice: book.price,
                totalPrice: book.price * quantity
            }
        });
        // Buscar pedido completo
        const orderWithItems = await this.prisma.order.findUnique({
            where: { id: order.id },
            include: { orderItems: { include: { book: true } } },
        });

        // NOVA FUNCIONALIDADE: Identificar o token do admin que criou o livro
        let adminToken = null;
        if (book.createdById) {
            // Buscar o token do admin que criou o livro
            const adminTokenRecord = await this.prisma.$queryRaw`
                SELECT token FROM admin_tokens 
                WHERE "adminId" = ${book.createdById} 
                AND "isActive" = true
            `;

            if (adminTokenRecord && Array.isArray(adminTokenRecord) && adminTokenRecord.length > 0) {
                adminToken = adminTokenRecord[0].token;
            }
        }

        const orderResponse = this.mapOrderToResponse(orderWithItems);

        // Gerar link de checkout com o token do admin se disponível
        const value = Math.round(orderResponse.totalAmount * 100); // valor em centavos
        const description = encodeURIComponent(
            this.buildInternalCheckoutDescription(orderResponse.items[0]?.bookTitle || '', book.createdBy?.cpf),
        );

        let checkoutUrl = `https://checkout.jbmidia.com/?value=${value}&description=${description}&store=ebook`;

        // Se temos o token do admin, adicionar ao URL
        if (adminToken) {
            checkoutUrl += `&adminToken=${encodeURIComponent(adminToken)}`;
        }

        return {
            ...orderResponse,
            checkoutUrl,
        };
    }

    async getOrders(userId: string, query: OrderQueryDto): Promise<{ orders: (OrderResponseDto & { checkoutUrl: string })[], total: number, page: number, limit: number }> {
        try {
            // Garantir que page e limit são números
            const page = Number(query.page) || 1;
            const limit = Number(query.limit) || 10;
            const { status } = query;
            const skip = (page - 1) * limit;

            const whereCondition: any = { userId };
            if (status) {
                whereCondition.status = status;
            }

            const [orders, total] = await Promise.all([
                this.prisma.order.findMany({
                    where: whereCondition,
                    include: {
                        orderItems: {
                            include: {
                                book: {
                                    include: {
                                        createdBy: true
                                    }
                                }
                            }
                        }
                    },
                    orderBy: { createdAt: 'desc' },
                    skip,
                    take: limit
                }),
                this.prisma.order.count({ where: whereCondition })
            ]);

            return {
                orders: await Promise.all(orders.map(async order => {
                    const orderResponse = this.mapOrderToResponse(order);

                    // NOVA FUNCIONALIDADE: Identificar o token do admin que criou o livro
                    let adminToken = null;
                    if (order.orderItems.length > 0 && order.orderItems[0].book.createdById) {
                        // Buscar o token do admin que criou o primeiro livro
                        const adminTokenRecord = await this.prisma.$queryRaw`
                            SELECT token FROM admin_tokens 
                            WHERE "adminId" = ${order.orderItems[0].book.createdById} 
                            AND "isActive" = true
                        `;

                        if (adminTokenRecord && Array.isArray(adminTokenRecord) && adminTokenRecord.length > 0) {
                            adminToken = adminTokenRecord[0].token;
                        }
                    }

                    // Gerar checkoutUrl baseado no primeiro item do pedido
                    const value = Math.round(orderResponse.totalAmount * 100);
                    const ownerCpfForDescription = order.orderItems[0]?.book.createdBy?.cpf;
                    const description = encodeURIComponent(
                        this.buildInternalCheckoutDescription(orderResponse.items[0]?.bookTitle || '', ownerCpfForDescription),
                    );

                    let checkoutUrl = `https://checkout.jbmidia.com/?value=${value}&description=${description}&store=ebook`;

                    // Se temos o token do admin, adicionar ao URL
                    if (adminToken) {
                        checkoutUrl += `&adminToken=${encodeURIComponent(adminToken)}`;
                    }

                    return { ...orderResponse, checkoutUrl };
                })),
                total,
                page,
                limit
            };
        } catch (error) {
            console.error('Erro ao listar pedidos do usuário:', error);
            throw new BadRequestException('Erro ao listar pedidos do usuário: ' + error.message);
        }
    }

    async getOrderById(userId: string, orderId: number): Promise<OrderResponseDto & { checkoutUrl: string }> {
        // Se for o sistema de checkout, busca sem filtrar por userId
        const whereCondition = userId === 'checkout-system'
            ? { id: orderId }  // Não filtra por usuário
            : { id: orderId, userId }; // Filtra por usuário normalmente

        const order = await this.prisma.order.findFirst({
            where: whereCondition,
            include: {
                orderItems: {
                    include: {
                        book: {
                            include: {
                                createdBy: true
                            }
                        }
                    }
                }
            }
        });

        if (!order) {
            throw new NotFoundException('Pedido não encontrado');
        }

        const orderResponse = this.mapOrderToResponse(order);
        const value = uuidv4();
        const ownerCpfForDescription = order.orderItems[0]?.book.createdBy?.cpf;
        const description = encodeURIComponent(
            this.buildInternalCheckoutDescription(orderResponse.items[0]?.bookTitle || '', ownerCpfForDescription),
        );

        // NOVA FUNCIONALIDADE: Identificar o token do admin que criou o livro
        let adminToken = null;
        if (order.orderItems.length > 0 && order.orderItems[0].book.createdById) {
            // Buscar o token do admin que criou o primeiro livro
            const adminTokenRecord = await this.prisma.$queryRaw`
                SELECT token FROM admin_tokens 
                WHERE "adminId" = ${order.orderItems[0].book.createdById} 
                AND "isActive" = true
            `;

            if (adminTokenRecord && Array.isArray(adminTokenRecord) && adminTokenRecord.length > 0) {
                adminToken = adminTokenRecord[0].token;
            }
        }

        let checkoutUrl = `https://checkout.jbmidia.com/?value=${value}&description=${description}&orderId=${orderResponse.id}&orderNumber=${orderResponse.orderNumber}&store=ebook`;

        // Se temos o token do admin, adicionar ao URL
        if (adminToken) {
            checkoutUrl += `&adminToken=${encodeURIComponent(adminToken)}`;
        }

        return { ...orderResponse, checkoutUrl };
    }

    async cancelOrder(userId: string, orderId: number): Promise<OrderResponseDto> {
        const order = await this.prisma.order.findFirst({
            where: {
                id: orderId,
                userId
            }
        });

        if (!order) {
            throw new NotFoundException('Pedido não encontrado');
        }

        if (order.status !== 'pending') {
            throw new BadRequestException('Apenas pedidos pendentes podem ser cancelados');
        }

        const updatedOrder = await this.prisma.order.update({
            where: { id: orderId },
            data: { status: 'cancelled' as OrderStatus },
            include: {
                orderItems: {
                    include: {
                        book: true
                    }
                }
            }
        });

        await this.invalidateOrderCache(userId);

        return this.mapOrderToResponse(updatedOrder);
    }

    /**
     * Remove do carrinho todos os livros de um pedido específico para o usuário.
     */
    async removeOrderBooksFromCart(userId: string, orderId: number): Promise<void> {
        // Buscar todos os itens do pedido
        const orderItems = await this.prisma.orderItem.findMany({
            where: { orderId },
        });
        if (!orderItems.length) return;
        // Remover cada bookId do carrinho do usuário
        for (const item of orderItems) {
            await this.prisma.cart.deleteMany({
                where: {
                    userId,
                    bookId: item.bookId
                }
            });
        }
        await this.invalidateCartCache(userId);
    }

    // Métodos auxiliares
    private async invalidateCartCache(userId: string): Promise<void> {
        await this.redisService.del(`cart:${userId}`);
    }

    private async invalidateOrderCache(userId: string): Promise<void> {
        await this.redisService.deleteByPattern(`orders:${userId}:*`);
    }

    private mapOrderToResponse(order: any): OrderResponseDto {
        // NOVA LÓGICA: calcular subtotal e totalAmount conforme originalPrice
        let subtotal = 0;
        let totalAmount = 0;
        for (const item of order.orderItems) {
            const price = item.book.price;
            const originalPrice = item.book.originalPrice;
            if (originalPrice && originalPrice > 0) {
                subtotal += price * item.quantity;
                totalAmount += originalPrice * item.quantity;
            } else {
                subtotal += price * item.quantity;
                totalAmount += price * item.quantity;
            }
        }
        return {
            id: order.id,
            orderNumber: order.orderNumber,
            status: order.status as OrderStatus,
            totalAmount,
            subtotal,
            discount: order.discount,
            paymentMethod: order.paymentMethod,
            paymentStatus: order.paymentStatus as PaymentStatus,
            shippingAddress: order.shippingAddress,
            billingAddress: order.billingAddress,
            notes: order.notes,
            createdAt: order.createdAt,
            updatedAt: order.updatedAt,
            items: order.orderItems.map(item => ({
                id: item.id,
                bookId: item.bookId,
                bookTitle: item.book.title,
                bookAuthor: item.book.author,
                bookCover: item.book.cover,
                quantity: item.quantity,
                unitPrice: item.book.price,
                totalPrice: item.book.price * item.quantity
            }))
        };
    }

    // Métodos para administração (apenas para admins)
    async getAllOrders(query: OrderQueryDto): Promise<{ orders: OrderResponseDto[], total: number, page: number, limit: number }> {
        const { page = 1, limit = 10, status } = query;
        const skip = (page - 1) * limit;

        const whereCondition: any = {};
        if (status) {
            whereCondition.status = status;
        }

        const [orders, total] = await Promise.all([
            this.prisma.order.findMany({
                where: whereCondition,
                include: {
                    orderItems: {
                        include: {
                            book: true
                        }
                    },
                    user: {
                        select: {
                            id: true,
                            name: true,
                            email: true
                        }
                    }
                },
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit
            }),
            this.prisma.order.count({ where: whereCondition })
        ]);

        return {
            orders: orders.map(order => this.mapOrderToResponse(order)),
            total,
            page,
            limit
        };
    }

    async updateOrderStatus(orderId: number, status: OrderStatus): Promise<OrderResponseDto> {
        const order = await this.prisma.order.findUnique({
            where: { id: orderId },
            include: {
                orderItems: {
                    include: {
                        book: true
                    }
                },
                user: true // ✅ ADICIONAR: incluir dados do usuário
            }
        });

        if (!order) {
            throw new NotFoundException('Pedido não encontrado');
        }

        const updatedOrder = await this.prisma.order.update({
            where: { id: orderId },
            data: { status },
            include: {
                orderItems: {
                    include: {
                        book: true
                    }
                },
                user: true // ✅ ADICIONAR: incluir dados do usuário
            }
        });

        // ✅ MELHORAR: Log de venda com mais informações
        if (status === 'paid') {
            for (const item of updatedOrder.orderItems) {
                const book = item.book;
                if (book && book.createdById) {
                    // Criar log de atividade
                    await this.prisma['activityLog'].create({
                        data: {
                            adminId: book.createdById,
                            type: 'sale',
                            message: `Venda realizada: "${book.title}" comprado por ${order.user?.name || 'usuário'} - Qtd: ${item.quantity} - Total: R$ ${item.totalPrice.toFixed(2)}`,
                            bookId: book.id,
                            bookTitle: book.title,
                        }
                    });

                    // ✅ NOVO: Atualizar contador de vendas do livro
                    await this.updateBookSalesCount(book.id, item.quantity);
                }
            }
        }

        return this.mapOrderToResponse(updatedOrder);
    }

    /**
     * Envia email de confirmação de compra para o usuário
     */
    async sendPurchaseConfirmationEmail(orderId: number): Promise<void> {
        try {
            // Buscar o pedido com todos os dados necessários
            const order = await this.prisma.order.findUnique({
                where: { id: orderId },
                include: {
                    orderItems: {
                        include: {
                            book: true
                        }
                    },
                    user: true
                }
            });

            if (!order || !order.user) {
                throw new Error(`Pedido ${orderId} não encontrado ou usuário inválido`);
            }

            // Preparar dados para o email
            const userName = order.user.name;
            const userEmail = order.user.email;
            const orderNumber = order.orderNumber;
            const totalAmount = new Intl.NumberFormat('pt-BR', {
                style: 'currency',
                currency: 'BRL'
            }).format(order.totalAmount);
            const purchaseDate = new Date().toLocaleDateString('pt-BR');

            // Listar os livros comprados
            const booksList = order.orderItems.map(item => 
                `• ${item.book.title} - ${item.book.author} (Qtd: ${item.quantity})`
            ).join('\n');

            // Enviar email
            await this.appService.sendMail({
                to: userEmail,
                subject: `🎉 Compra Confirmada - ${orderNumber}`,
                html: `
                    <!DOCTYPE html>
                    <html lang="pt-BR">
                    <head>
                        <meta charset="UTF-8">
                        <meta name="viewport" content="width=device-width, initial-scale=1.0">
                        <title>Compra Confirmada</title>
                        <style>
                            * {
                                margin: 0;
                                padding: 0;
                                box-sizing: border-box;
                            }
                            
                            body {
                                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
                                background: linear-gradient(135deg, #0f0f0f 0%, #1a1a1a 100%);
                                color: #ffffff;
                                line-height: 1.6;
                            }
                            
                            .container {
                                max-width: 600px;
                                margin: 0 auto;
                                padding: 40px 20px;
                            }
                            
                            .header {
                                text-align: center;
                                margin-bottom: 40px;
                            }
                            
                            .logo {
                                font-size: 32px;
                                font-weight: 700;
                                color: #ffffff;
                                margin-bottom: 8px;
                                letter-spacing: -0.5px;
                            }
                            
                            .subtitle {
                                color: #a1a1aa;
                                font-size: 16px;
                                font-weight: 400;
                            }
                            
                            .card {
                                background: #1f1f1f;
                                border: 1px solid #2a2a2a;
                                border-radius: 12px;
                                padding: 32px;
                                margin-bottom: 24px;
                                box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
                            }
                            
                            .success-title {
                                font-size: 28px;
                                font-weight: 700;
                                color: #22c55e;
                                margin-bottom: 16px;
                                text-align: center;
                            }
                            
                            .success-text {
                                color: #d4d4d8;
                                font-size: 16px;
                                margin-bottom: 24px;
                                text-align: center;
                            }
                            
                            .order-info {
                                background: #2a2a2a;
                                border-radius: 8px;
                                padding: 20px;
                                margin: 24px 0;
                            }
                            
                            .info-grid {
                                display: grid;
                                grid-template-columns: 1fr 1fr;
                                gap: 16px;
                                margin-top: 16px;
                            }
                            
                            .info-item {
                                display: flex;
                                flex-direction: column;
                            }
                            
                            .info-label {
                                color: #a1a1aa;
                                font-size: 12px;
                                font-weight: 500;
                                text-transform: uppercase;
                                letter-spacing: 0.5px;
                                margin-bottom: 4px;
                            }
                            
                            .info-value {
                                color: #ffffff;
                                font-size: 14px;
                                font-weight: 600;
                                margin-left: 6px;
                            }
                            
                            .books-section {
                                margin: 24px 0;
                            }
                            
                            .books-title {
                                font-size: 18px;
                                font-weight: 600;
                                color: #ffffff;
                                margin-bottom: 16px;
                            }
                            
                            .book-item {
                                background: #2a2a2a;
                                border-radius: 6px;
                                padding: 12px;
                                margin-bottom: 8px;
                                color: #d4d4d8;
                                font-size: 14px;
                            }
                            
                            .cta-button {
                                display: inline-block;
                                background: #22c55e;
                                color: #000000;
                                text-decoration: none;
                                padding: 12px 24px;
                                border-radius: 8px;
                                font-weight: 600;
                                font-size: 14px;
                                text-align: center;
                                margin: 24px 0;
                                transition: all 0.2s ease;
                            }
                            
                            .cta-button:hover {
                                background: #16a34a;
                                transform: translateY(-1px);
                            }
                            
                            .footer {
                                text-align: center;
                                margin-top: 40px;
                                padding-top: 24px;
                                border-top: 1px solid #2a2a2a;
                            }
                            
                            .footer-text {
                                color: #71717a;
                                font-size: 12px;
                                line-height: 1.5;
                            }
                            
                            .badge {
                                display: inline-block;
                                background: #22c55e;
                                color: #000000;
                                padding: 4px 8px;
                                border-radius: 4px;
                                font-size: 11px;
                                font-weight: 600;
                                text-transform: uppercase;
                                letter-spacing: 0.5px;
                            }
                            
                            @media (max-width: 600px) {
                                .container {
                                    padding: 20px 16px;
                                }
                                
                                .card {
                                    padding: 24px;
                                }
                                
                                .info-grid {
                                    grid-template-columns: 1fr;
                                }
                                
                                .success-title {
                                    font-size: 24px;
                                }
                            }
                        </style>
                    </head>
                    <body>
                        <div class="container">
                            <div class="header">
                                <div class="logo">EbookSIM</div>
                                <div class="subtitle">Sua biblioteca digital</div>
                            </div>
                            
                            <div class="card">
                                <h1 class="success-title">🎉 Compra Confirmada!</h1>
                                <p class="success-text">
                                    Olá <strong>${userName}</strong>, sua compra foi realizada com sucesso! 
                                    Os livros já estão disponíveis na sua biblioteca.
                                </p>
                                
                                <div class="order-info">
                                    <div class="badge">Pedido Confirmado</div>
                                    <div class="info-grid">
                                        <div class="info-item">
                                            <span class="info-label">Número do Pedido</span>
                                            <span class="info-value">${orderNumber}</span>
                                        </div>
                                        <div class="info-item">
                                            <span class="info-label">Data da Compra</span>
                                            <span class="info-value">${purchaseDate}</span>
                                        </div>
                                        <div class="info-item">
                                            <span class="info-label">Total Pago</span>
                                            <span class="info-value">${totalAmount}</span>
                                        </div>
                                        <div class="info-item">
                                            <span class="info-label">Status</span>
                                            <span class="info-value">Pago</span>
                                        </div>
                                    </div>
                                </div>
                                
                                <div class="books-section">
                                    <h3 class="books-title">📚 Livros Adquiridos:</h3>
                                    ${order.orderItems.map(item => `
                                        <div class="book-item">
                                            <strong>${item.book.title}</strong><br>
                                            <small>Autor: ${item.book.author}</small><br>
                                            <small>Quantidade: ${item.quantity}</small>
                                        </div>
                                    `).join('')}
                                </div>
                                
                                <a href="${process.env.FRONTEND_URL || 'https://ebooksim.com'}/library" class="cta-button">
                                    📚 Acessar Minha Biblioteca
                                </a>
                                
                                <p style="text-align: center; color: #a1a1aa; font-size: 14px; margin-top: 24px;">
                                    Os livros já estão disponíveis para download na sua conta. 
                                    Acesse sua biblioteca para começar a ler!
                                </p>
                            </div>
                            
                            <div class="footer">
                                <p class="footer-text">
                                    Este é um email automático. Se você tiver alguma dúvida, 
                                    entre em contato conosco através do suporte.
                                </p>
                                <p class="footer-text">
                                    Data e hora do envio: ${new Date().toLocaleString('pt-BR')}
                                </p>
                            </div>
                        </div>
                    </body>
                    </html>
                `
            });

            console.log(`✅ Email de confirmação de compra enviado com sucesso para ${userEmail} - Pedido: ${orderNumber}`);
        } catch (error) {
            console.error(`❌ Erro ao enviar email de confirmação de compra para pedido ${orderId}:`, error);
            // Não vamos lançar o erro para não interromper o fluxo principal
        }
    }

    /**
     * Método de teste para enviar email de confirmação de compra
     */
    async sendTestPurchaseConfirmationEmail(): Promise<void> {
        try {
            // Dados de teste
            const testOrder = {
                user: {
                    name: 'Breno Teste',
                    email: 'brenohslima@gmail.com'
                },
                orderNumber: 'TEST-2025-999999',
                totalAmount: 49.90,
                orderItems: [
                    {
                        book: {
                            title: 'Livro de Teste - Confirmação de Compra',
                            author: 'Autor Teste'
                        },
                        quantity: 1
                    },
                    {
                        book: {
                            title: 'Outro Livro de Teste',
                            author: 'Outro Autor'
                        },
                        quantity: 2
                    }
                ]
            };

            // Preparar dados para o email
            const userName = testOrder.user.name;
            const userEmail = testOrder.user.email;
            const orderNumber = testOrder.orderNumber;
            const totalAmount = new Intl.NumberFormat('pt-BR', {
                style: 'currency',
                currency: 'BRL'
            }).format(testOrder.totalAmount);
            const purchaseDate = new Date().toLocaleDateString('pt-BR');

            // Enviar email
            await this.appService.sendMail({
                to: userEmail,
                subject: `🎉 Compra Confirmada - ${orderNumber}`,
                html: `
                    <!DOCTYPE html>
                    <html lang="pt-BR">
                    <head>
                        <meta charset="UTF-8">
                        <meta name="viewport" content="width=device-width, initial-scale=1.0">
                        <title>Compra Confirmada</title>
                        <style>
                            * {
                                margin: 0;
                                padding: 0;
                                box-sizing: border-box;
                            }
                            
                            body {
                                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
                                background: linear-gradient(135deg, #0f0f0f 0%, #1a1a1a 100%);
                                color: #ffffff;
                                line-height: 1.6;
                            }
                            
                            .container {
                                max-width: 600px;
                                margin: 0 auto;
                                padding: 40px 20px;
                            }
                            
                            .header {
                                text-align: center;
                                margin-bottom: 40px;
                            }
                            
                            .logo {
                                font-size: 32px;
                                font-weight: 700;
                                color: #ffffff;
                                margin-bottom: 8px;
                                letter-spacing: -0.5px;
                            }
                            
                            .subtitle {
                                color: #a1a1aa;
                                font-size: 16px;
                                font-weight: 400;
                            }
                            
                            .card {
                                background: #1f1f1f;
                                border: 1px solid #2a2a2a;
                                border-radius: 12px;
                                padding: 32px;
                                margin-bottom: 24px;
                                box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
                            }
                            
                            .success-title {
                                font-size: 28px;
                                font-weight: 700;
                                color: #22c55e;
                                margin-bottom: 16px;
                                text-align: center;
                            }
                            
                            .success-text {
                                color: #d4d4d8;
                                font-size: 16px;
                                margin-bottom: 24px;
                                text-align: center;
                            }
                            
                            .order-info {
                                background: #2a2a2a;
                                border-radius: 8px;
                                padding: 20px;
                                margin: 24px 0;
                            }
                            
                            .info-grid {
                                display: grid;
                                grid-template-columns: 1fr 1fr;
                                gap: 16px;
                                margin-top: 16px;
                            }
                            
                            .info-item {
                                display: flex;
                                flex-direction: column;
                            }
                            
                            .info-label {
                                color: #a1a1aa;
                                font-size: 12px;
                                font-weight: 500;
                                text-transform: uppercase;
                                letter-spacing: 0.5px;
                                margin-bottom: 4px;
                            }
                            
                            .info-value {
                                color: #ffffff;
                                font-size: 14px;
                                font-weight: 600;
                                margin-left: 6px;
                            }
                            
                            .books-section {
                                margin: 24px 0;
                            }
                            
                            .books-title {
                                font-size: 18px;
                                font-weight: 600;
                                color: #ffffff;
                                margin-bottom: 16px;
                            }
                            
                            .book-item {
                                background: #2a2a2a;
                                border-radius: 6px;
                                padding: 12px;
                                margin-bottom: 8px;
                                color: #d4d4d8;
                                font-size: 14px;
                            }
                            
                            .cta-button {
                                display: inline-block;
                                background: #22c55e;
                                color: #000000;
                                text-decoration: none;
                                padding: 12px 24px;
                                border-radius: 8px;
                                font-weight: 600;
                                font-size: 14px;
                                text-align: center;
                                margin: 24px 0;
                                transition: all 0.2s ease;
                            }
                            
                            .cta-button:hover {
                                background: #16a34a;
                                transform: translateY(-1px);
                            }
                            
                            .footer {
                                text-align: center;
                                margin-top: 40px;
                                padding-top: 24px;
                                border-top: 1px solid #2a2a2a;
                            }
                            
                            .footer-text {
                                color: #71717a;
                                font-size: 12px;
                                line-height: 1.5;
                            }
                            
                            .badge {
                                display: inline-block;
                                background: #22c55e;
                                color: #000000;
                                padding: 4px 8px;
                                border-radius: 4px;
                                font-size: 11px;
                                font-weight: 600;
                                text-transform: uppercase;
                                letter-spacing: 0.5px;
                            }
                            
                            .test-badge {
                                display: inline-block;
                                background: #f59e0b;
                                color: #000000;
                                padding: 4px 8px;
                                border-radius: 4px;
                                font-size: 11px;
                                font-weight: 600;
                                text-transform: uppercase;
                                letter-spacing: 0.5px;
                                margin-bottom: 16px;
                            }
                            
                            .info-grid {
                                display: grid;
                                grid-template-columns: 1fr 1fr;
                                gap: 32px;
                                margin-top: 24px;
                            }
                            
                            .info-item {
                                display: flex;
                                flex-direction: column;
                                margin-bottom: 16px;
                            }
                            
                            .info-label {
                                color: #a1a1aa;
                                font-size: 12px;
                                font-weight: 500;
                                text-transform: uppercase;
                                letter-spacing: 0.5px;
                                margin-bottom: 8px;
                            }
                            
                            @media (max-width: 600px) {
                                .container {
                                    padding: 20px 16px;
                                }
                                
                                .card {
                                    padding: 24px;
                                }
                                
                                .info-grid {
                                    grid-template-columns: 1fr;
                                }
                                
                                .success-title {
                                    font-size: 24px;
                                }
                            }
                        </style>
                    </head>
                    <body>
                        <div class="container">
                            <div class="header">
                                <div class="logo">EbookSIM</div>
                                <div class="subtitle">Sua biblioteca digital</div>
                            </div>
                            
                            <div class="card">
                                <div class="test-badge">🧪 EMAIL DE TESTE</div>
                                <h1 class="success-title">🎉 Compra Confirmada!</h1>
                                <p class="success-text">
                                    Olá <strong>${userName}</strong>, sua compra foi realizada com sucesso! 
                                    Os livros já estão disponíveis na sua biblioteca.
                                </p>
                                
                                <div class="order-info">
                                    <div class="badge">Pedido Confirmado</div>
                                    <div class="info-grid">
                                        <div class="info-item">
                                            <span class="badge">Número do Pedido</span>
                                            <span class="info-value">${orderNumber}</span>
                                        </div>
                                        <div class="info-item">
                                            <span class="badge">Data da Compra</span>
                                            <span class="info-value">${purchaseDate}</span>
                                        </div>
                                        <div class="info-item">
                                            <span class="badge">Total Pago</span>
                                            <span class="info-value">${totalAmount}</span>
                                        </div>
                                        <div class="info-item">
                                            <span class="badge">Status</span>
                                            <span class="info-value">Pago</span>
                                        </div>
                                    </div>
                                </div>
                                
                                <div class="books-section">
                                    <h3 class="books-title">📚 Livros Adquiridos:</h3>
                                    ${testOrder.orderItems.map(item => `
                                        <div class="book-item">
                                            <strong>${item.book.title}</strong><br>
                                            <small>Autor: ${item.book.author}</small><br>
                                            <small>Quantidade: ${item.quantity}</small>
                                        </div>
                                    `).join('')}
                                </div>
                                
                                <a href="${process.env.FRONTEND_URL || 'https://ebooksim.com'}/library" class="cta-button">
                                    📚 Acessar Minha Biblioteca
                                </a>
                                
                                <p style="text-align: center; color: #a1a1aa; font-size: 14px; margin-top: 24px;">
                                    Os livros já estão disponíveis para download na sua conta. 
                                    Acesse sua biblioteca para começar a ler!
                                </p>
                            </div>
                            
                            <div class="footer">
                                <p class="footer-text">
                                    <strong>🧪 Este é um email de teste para visualizar o design.</strong><br>
                                    Em produção, este email será enviado automaticamente após confirmação de pagamento.
                                </p>
                                <p class="footer-text">
                                    Data e hora do envio: ${new Date().toLocaleString('pt-BR')}
                                </p>
                            </div>
                        </div>
                    </body>
                    </html>
                `
            });

            console.log(`✅ Email de teste de confirmação de compra enviado com sucesso para ${userEmail}`);
        } catch (error) {
            console.error(`❌ Erro ao enviar email de teste de confirmação de compra:`, error);
            throw error;
        }
    }

    /**
     * Atualiza o contador de vendas de um livro
     */
    private async updateBookSalesCount(bookId: number, quantity: number): Promise<void> {
        try {
            // Buscar o livro atual
            const book = await this.prisma.book.findUnique({
                where: { id: bookId },
                select: { sales: true }
            });

            if (!book) {
                console.warn(`⚠️ Livro ${bookId} não encontrado para atualizar vendas`);
                return;
            }

            // Calcular novo total de vendas
            const newSalesCount = (book.sales || 0) + quantity;

            // Atualizar o campo sales do livro
            await this.prisma.book.update({
                where: { id: bookId },
                data: { sales: newSalesCount }
            });

            console.log(`✅ Vendas do livro ${bookId} atualizadas: ${book.sales || 0} → ${newSalesCount} (+${quantity})`);
        } catch (error) {
            console.error(`❌ Erro ao atualizar vendas do livro ${bookId}:`, error);
            // Não vamos lançar o erro para não interromper o fluxo principal
        }
    }
}
