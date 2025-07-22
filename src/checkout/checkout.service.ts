import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { RedisService } from 'src/redis.service';
import { NotificationService } from 'src/notification/notification.service';
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
    constructor(
        private readonly prisma: PrismaService,
        private readonly redisService: RedisService,
        private readonly notificationService: NotificationService,
    ) { }

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
                book: true
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
            checkoutUrl: `https://checkout.jbmidia.com/?value=${item.book.price}&description=${encodeURIComponent(item.book.title)}`
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
                book: true
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
        // Gerar link de checkout
        const value = Math.round(orderResponse.totalAmount * 100); // valor em centavos
        const description = encodeURIComponent(orderResponse.items[0]?.bookTitle || '');
        const checkoutUrl = `https://checkout.jbmidia.com/?value=${value}&description=${description}`;
        return {
            ...orderResponse,
            checkoutUrl,
        };
    }

    async createOrderFromBook(userId: string, data: { bookId: number; quantity?: number }): Promise<OrderResponseDto> {
        // Buscar o livro
        const book = await this.prisma.book.findUnique({ where: { id: data.bookId } });
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
        return this.mapOrderToResponse(orderWithItems);
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
                                book: true
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
                orders: orders.map(order => {
                    const orderResponse = this.mapOrderToResponse(order);
                    // Gerar checkoutUrl baseado no primeiro item do pedido
                    const value = Math.round(orderResponse.totalAmount * 100);
                    const description = encodeURIComponent(orderResponse.items[0]?.bookTitle || '');
                    const checkoutUrl = `https://checkout.jbmidia.com/?value=${value}&description=${description}`;
                    return { ...orderResponse, checkoutUrl };
                }),
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
                        book: true
                    }
                }
            }
        });

        if (!order) {
            throw new NotFoundException('Pedido não encontrado');
        }

        const orderResponse = this.mapOrderToResponse(order);
        const value = uuidv4();
        const description = encodeURIComponent(orderResponse.items[0]?.bookTitle || '');
        const checkoutUrl = `https://checkout.jbmidia.com/?value=${value}&description=${description}&orderId=${orderResponse.id}&orderNumber=${orderResponse.orderNumber}`;
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
                    await this.prisma['activityLog'].create({
                        data: {
                            adminId: book.createdById,
                            type: 'sale',
                            message: `Venda realizada: "${book.title}" comprado por ${order.user?.name || 'usuário'} - Qtd: ${item.quantity} - Total: R$ ${item.totalPrice.toFixed(2)}`,
                            bookId: book.id,
                            bookTitle: book.title,
                        }
                    });
                }
            }
        }

        return this.mapOrderToResponse(updatedOrder);
    }
}
