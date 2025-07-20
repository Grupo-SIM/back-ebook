import {
    Controller,
    Get,
    Post,
    Put,
    Delete,
    Body,
    Param,
    Query,
    UseGuards,
    Request,
    ForbiddenException
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuardAll } from 'src/auth/guard/jwt-auth.guard';
import { NotificationService } from './notification.service';
import {
    NotificationDto,
    CreateNotificationDto,
    UpdateNotificationDto,
    NotificationQueryDto,
    NotificationsStateDto,
    Notification,
    NotificationsState
} from './dto/notification.dto';

@ApiTags('Notifications')
@Controller('notifications')
@UseGuards(JwtAuthGuardAll)
@ApiBearerAuth()
export class NotificationController {
    constructor(private readonly notificationService: NotificationService) { }

    @Get()
    @ApiOperation({ summary: 'Listar notificações do usuário' })
    @ApiQuery({ name: 'page', required: false, type: Number })
    @ApiQuery({ name: 'limit', required: false, type: Number })
    @ApiQuery({ name: 'type', required: false, enum: ['info', 'success', 'warning', 'error'] })
    @ApiQuery({ name: 'read', required: false, type: Boolean })
    @ApiResponse({ status: 200, description: 'Lista de notificações' })
    async getNotifications(@Request() req, @Query() query: NotificationQueryDto) {
        return this.notificationService.getNotifications(req.user.id, query);
    }

    @Get('state')
    @ApiOperation({ summary: 'Obter estado das notificações' })
    @ApiResponse({ status: 200, description: 'Estado das notificações', type: NotificationsStateDto })
    async getNotificationsState(@Request() req): Promise<NotificationsState> {
        return this.notificationService.getNotificationsState(req.user.id);
    }

    @Post()
    @ApiOperation({ summary: 'Criar notificação' })
    @ApiResponse({ status: 201, description: 'Notificação criada com sucesso', type: NotificationDto })
    async createNotification(@Request() req, @Body() data: CreateNotificationDto): Promise<Notification> {
        if (req.user.role !== 'ADMIN') {
            throw new ForbiddenException('Apenas administradores podem criar notificações.');
        }
        return this.notificationService.createNotification(req.user.id, data);
    }

    @Put(':id/read')
    @ApiOperation({ summary: 'Marcar notificação como lida' })
    @ApiParam({ name: 'id', description: 'ID da notificação' })
    @ApiResponse({ status: 200, description: 'Notificação marcada como lida', type: NotificationDto })
    @ApiResponse({ status: 404, description: 'Notificação não encontrada' })
    async markAsRead(@Request() req, @Param('id') notificationId: string): Promise<Notification> {
        return this.notificationService.markAsRead(req.user.id, notificationId);
    }

    @Put('read-all')
    @ApiOperation({ summary: 'Marcar todas as notificações como lidas' })
    @ApiResponse({ status: 200, description: 'Todas as notificações marcadas como lidas' })
    async markAllAsRead(@Request() req): Promise<void> {
        return this.notificationService.markAllAsRead(req.user.id);
    }

    @Delete(':id')
    @ApiOperation({ summary: 'Deletar notificação' })
    @ApiParam({ name: 'id', description: 'ID da notificação' })
    @ApiResponse({ status: 200, description: 'Notificação deletada com sucesso' })
    @ApiResponse({ status: 404, description: 'Notificação não encontrada' })
    async deleteNotification(@Request() req, @Param('id') notificationId: string): Promise<void> {
        return this.notificationService.deleteNotification(req.user.id, notificationId);
    }

    @Delete()
    @ApiOperation({ summary: 'Deletar todas as notificações' })
    @ApiResponse({ status: 200, description: 'Todas as notificações deletadas com sucesso' })
    async deleteAllNotifications(@Request() req): Promise<void> {
        return this.notificationService.deleteAllNotifications(req.user.id);
    }

    // Endpoints administrativos (apenas para admins)
    @Post('admin/broadcast')
    @ApiOperation({ summary: 'Enviar notificação para todos os usuários (Admin)' })
    @ApiResponse({ status: 201, description: 'Notificação enviada para todos os usuários' })
    async notifyAllUsers(@Body() data: CreateNotificationDto): Promise<void> {
        return this.notificationService.notifyAllUsers(data.title, data.message, data.type);
    }

    @Post('admin/broadcast-by-role')
    @ApiOperation({ summary: 'Enviar notificação para usuários por role (Admin)' })
    @ApiResponse({ status: 201, description: 'Notificação enviada para usuários da role' })
    async notifyUsersByRole(
        @Body() data: CreateNotificationDto & { role: string }
    ): Promise<void> {
        return this.notificationService.notifyUsersByRole(data.title, data.message, data.role, data.type);
    }
} 