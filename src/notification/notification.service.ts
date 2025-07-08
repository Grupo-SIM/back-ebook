import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { RedisService } from 'src/redis.service';
import {
    Notification,
    NotificationsState,
    CreateNotificationDto,
    UpdateNotificationDto,
    NotificationQueryDto,
    NotificationType
} from './dto/notification.dto';

@Injectable()
export class NotificationService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly redisService: RedisService,
    ) { }

    // Criar notificação
    async createNotification(userId: string, data: CreateNotificationDto): Promise<Notification> {
        const notification = await this.prisma.notification.create({
            data: {
                userId,
                title: data.title,
                message: data.message,
                type: data.type || 'info',
                action: data.action ? data.action as any : null
            }
        });

        await this.invalidateNotificationCache(userId);

        return this.mapNotificationToResponse(notification);
    }

    // Listar notificações do usuário
    async getNotifications(userId: string, query: NotificationQueryDto): Promise<{ notifications: Notification[], total: number, page: number, limit: number }> {
        console.log('getNotifications called with:', { userId, query });

        const { page = 1, limit = 10, type, read } = query;
        const skip = (page - 1) * limit;

        const whereCondition: any = { userId };
        if (type) whereCondition.type = type;
        if (read !== undefined) whereCondition.read = read;

        console.log('whereCondition:', whereCondition);

        try {
            const [notifications, total] = await Promise.all([
                this.prisma.notification.findMany({
                    where: whereCondition,
                    orderBy: { createdAt: 'desc' },
                    skip,
                    take: limit
                }),
                this.prisma.notification.count({ where: whereCondition })
            ]);

            console.log('Query results:', { notificationsCount: notifications.length, total });

            return {
                notifications: notifications.map(notification => this.mapNotificationToResponse(notification)),
                total,
                page,
                limit
            };
        } catch (error) {
            console.error('Error in getNotifications:', error);
            throw error;
        }
    }

    // Obter estado das notificações
    async getNotificationsState(userId: string): Promise<NotificationsState> {
        const cacheKey = `notifications_state:${userId}`;
        const cached = await this.redisService.get(cacheKey);

        if (cached) {
            return JSON.parse(cached);
        }

        const [notifications, unreadCount] = await Promise.all([
            this.prisma.notification.findMany({
                where: { userId },
                orderBy: { createdAt: 'desc' },
                take: 50 // Limitar a 50 notificações mais recentes
            }),
            this.prisma.notification.count({
                where: {
                    userId,
                    read: false
                }
            })
        ]);

        const state: NotificationsState = {
            items: notifications.map(notification => this.mapNotificationToResponse(notification)),
            unreadCount
        };

        await this.redisService.set(cacheKey, JSON.stringify(state), 300); // 5 minutos

        return state;
    }

    // Marcar notificação como lida
    async markAsRead(userId: string, notificationId: string): Promise<Notification> {
        const notification = await this.prisma.notification.findFirst({
            where: {
                id: notificationId,
                userId
            }
        });

        if (!notification) {
            throw new NotFoundException('Notificação não encontrada');
        }

        const updatedNotification = await this.prisma.notification.update({
            where: { id: notificationId },
            data: { read: true }
        });

        await this.invalidateNotificationCache(userId);

        return this.mapNotificationToResponse(updatedNotification);
    }

    // Marcar todas como lidas
    async markAllAsRead(userId: string): Promise<void> {
        await this.prisma.notification.updateMany({
            where: {
                userId,
                read: false
            },
            data: { read: true }
        });

        await this.invalidateNotificationCache(userId);
    }

    // Deletar notificação
    async deleteNotification(userId: string, notificationId: string): Promise<void> {
        const notification = await this.prisma.notification.findFirst({
            where: {
                id: notificationId,
                userId
            }
        });

        if (!notification) {
            throw new NotFoundException('Notificação não encontrada');
        }

        await this.prisma.notification.delete({
            where: { id: notificationId }
        });

        await this.invalidateNotificationCache(userId);
    }

    // Deletar todas as notificações
    async deleteAllNotifications(userId: string): Promise<void> {
        await this.prisma.notification.deleteMany({
            where: { userId }
        });

        await this.invalidateNotificationCache(userId);
    }

    // Notificações automáticas baseadas em eventos
    async notifyBookInPromotion(userId: string, bookTitle: string, discount: number): Promise<void> {
        await this.createNotification(userId, {
            title: 'Livro em Promoção!',
            message: `O livro "${bookTitle}" está com ${discount}% de desconto!`,
            type: 'success',
            action: {
                label: 'Ver Promoção',
                onClick: 'view_promotion'
            }
        });
    }

    async notifyFavoriteBookAvailable(userId: string, bookTitle: string): Promise<void> {
        await this.createNotification(userId, {
            title: 'Livro Favorito Disponível',
            message: `O livro "${bookTitle}" que você favoritou está disponível para compra!`,
            type: 'info',
            action: {
                label: 'Ver Livro',
                onClick: 'view_book'
            }
        });
    }

    async notifyCartSaved(userId: string): Promise<void> {
        await this.createNotification(userId, {
            title: 'Carrinho Salvo',
            message: 'Seus itens no carrinho foram salvos automaticamente.',
            type: 'info',
            action: {
                label: 'Ver Carrinho',
                onClick: 'view_cart'
            }
        });
    }

    async notifyNewBookInCategory(userId: string, categoryName: string, bookTitle: string): Promise<void> {
        await this.createNotification(userId, {
            title: 'Novo Livro na Categoria',
            message: `Um novo livro "${bookTitle}" foi adicionado à categoria "${categoryName}".`,
            type: 'info',
            action: {
                label: 'Ver Livro',
                onClick: 'view_book'
            }
        });
    }

    async notifyOrderStatusUpdate(userId: string, orderNumber: string, status: string): Promise<void> {
        const statusMessages = {
            'paid': 'foi pago com sucesso',
            'delivered': 'foi entregue',
            'cancelled': 'foi cancelado'
        };

        await this.createNotification(userId, {
            title: 'Status do Pedido Atualizado',
            message: `Seu pedido ${orderNumber} ${statusMessages[status] || 'teve o status atualizado'}.`,
            type: status === 'cancelled' ? 'warning' : 'success',
            action: {
                label: 'Ver Pedido',
                onClick: 'view_order'
            }
        });
    }

    // Métodos auxiliares
    private async invalidateNotificationCache(userId: string): Promise<void> {
        await this.redisService.deleteByPattern(`notifications:${userId}:*`);
        await this.redisService.del(`notifications_state:${userId}`);
    }

    private mapNotificationToResponse(notification: any): Notification {
        return {
            id: notification.id,
            title: notification.title,
            message: notification.message,
            type: notification.type as NotificationType,
            read: notification.read,
            createdAt: notification.createdAt,
            action: notification.action ? notification.action as any : undefined
        };
    }

    // Métodos para notificações em lote (para admins)
    async notifyAllUsers(title: string, message: string, type: NotificationType = 'info'): Promise<void> {
        const users = await this.prisma.user.findMany({
            where: { isActive: true },
            select: { id: true }
        });

        const notifications = users.map(user => ({
            userId: user.id,
            title,
            message,
            type,
            action: null
        }));

        await this.prisma.notification.createMany({
            data: notifications
        });

        // Invalidar cache de todos os usuários
        for (const user of users) {
            await this.invalidateNotificationCache(user.id);
        }
    }

    async notifyUsersByRole(title: string, message: string, role: string, type: NotificationType = 'info'): Promise<void> {
        const users = await this.prisma.user.findMany({
            where: {
                isActive: true,
                role: role as any
            },
            select: { id: true }
        });

        const notifications = users.map(user => ({
            userId: user.id,
            title,
            message,
            type,
            action: null
        }));

        await this.prisma.notification.createMany({
            data: notifications
        });

        // Invalidar cache dos usuários
        for (const user of users) {
            await this.invalidateNotificationCache(user.id);
        }
    }
} 