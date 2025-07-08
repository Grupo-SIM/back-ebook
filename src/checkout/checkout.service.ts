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
            totalPrice: item.book.price * item.quantity
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
    async createOrder(userId: string, data: CreateOrderDto): Promise<OrderResponseDto> {
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

        // Calcular totais
        const subtotal = cartItems.reduce((sum, item) => sum + (item.book.price * item.quantity), 0);
        const tax = subtotal * 0.1; // 10% de imposto
        const discount = 0; // Pode ser implementado com cupons
        const totalAmount = subtotal + tax - discount;

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
                tax,
                discount,
                paymentMethod: data.paymentMethod,
                paymentStatus: 'pending' as PaymentStatus,
                shippingAddress: data.shippingAddress as any,
                billingAddress: data.billingAddress as any,
                notes: data.notes
            }
        });

        // Criar itens do pedido
        const orderItems = await Promise.all(
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
        const completeOrder = await this.prisma.order.findUnique({
            where: { id: order.id },
            include: {
                orderItems: {
                    include: {
                        book: true
                    }
                }
            }
        });

        return this.mapOrderToResponse(completeOrder);
    }

    async getOrders(userId: string, query: OrderQueryDto): Promise<{ orders: OrderResponseDto[], total: number, page: number, limit: number }> {
        const { page = 1, limit = 10, status } = query;
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
            orders: orders.map(order => this.mapOrderToResponse(order)),
            total,
            page,
            limit
        };
    }

    async getOrderById(userId: string, orderId: number): Promise<OrderResponseDto> {
        const order = await this.prisma.order.findFirst({
            where: {
                id: orderId,
                userId
            },
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

        return this.mapOrderToResponse(order);
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

    // Métodos auxiliares
    private async invalidateCartCache(userId: string): Promise<void> {
        await this.redisService.del(`cart:${userId}`);
    }

    private async invalidateOrderCache(userId: string): Promise<void> {
        await this.redisService.deleteByPattern(`orders:${userId}:*`);
    }

    private mapOrderToResponse(order: any): OrderResponseDto {
        return {
            id: order.id,
            orderNumber: order.orderNumber,
            status: order.status as OrderStatus,
            totalAmount: order.totalAmount,
            subtotal: order.subtotal,
            tax: order.tax,
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
                unitPrice: item.unitPrice,
                totalPrice: item.totalPrice
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
                }
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
                }
            }
        });

        return this.mapOrderToResponse(updatedOrder);
    }
} 