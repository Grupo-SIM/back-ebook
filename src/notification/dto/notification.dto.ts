import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsBoolean, IsEnum, IsObject } from 'class-validator';
import { Transform } from 'class-transformer';

export type NotificationType = 'info' | 'success' | 'warning' | 'error';

// Interfaces TypeScript puras conforme especificado
export interface Notification {
    id: string;
    title: string;
    message: string;
    type: 'info' | 'success' | 'warning' | 'error';
    read: boolean;
    createdAt: Date;
    action?: {
        label: string;
        onClick: string;
    };
}

export interface NotificationsState {
    items: Notification[];
    unreadCount: number;
}

// DTOs para API
export class NotificationDto implements Notification {
    @ApiProperty({ example: 'uuid-string' })
    id: string;

    @ApiProperty({ example: 'Livro em Promoção' })
    title: string;

    @ApiProperty({ example: 'O livro "O Senhor dos Anéis" está com 20% de desconto!' })
    message: string;

    @ApiProperty({
        example: 'success',
        enum: ['info', 'success', 'warning', 'error']
    })
    type: NotificationType;

    @ApiProperty({ example: false })
    read: boolean;

    @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
    createdAt: Date;

    @ApiProperty({
        example: { label: 'Ver Promoção', onClick: 'view_promotion' },
        required: false
    })
    action?: {
        label: string;
        onClick: string;
    };
}

export class CreateNotificationDto {
    @ApiProperty({ example: 'Livro em Promoção' })
    @IsString()
    title: string;

    @ApiProperty({ example: 'O livro "O Senhor dos Anéis" está com 20% de desconto!' })
    @IsString()
    message: string;

    @ApiProperty({
        example: 'success',
        enum: ['info', 'success', 'warning', 'error'],
        required: false
    })
    @IsOptional()
    @IsEnum(['info', 'success', 'warning', 'error'])
    type?: NotificationType = 'info';

    @ApiProperty({
        example: { label: 'Ver Promoção', onClick: 'view_promotion' },
        required: false
    })
    @IsOptional()
    @IsObject()
    action?: {
        label: string;
        onClick: string;
    };
}

export class UpdateNotificationDto {
    @ApiProperty({ example: true })
    @IsBoolean()
    read: boolean;
}

export class NotificationQueryDto {
    @ApiProperty({ example: 1, required: false })
    @IsOptional()
    @Transform(({ value }) => parseInt(value))
    page?: number = 1;

    @ApiProperty({ example: 10, required: false })
    @IsOptional()
    @Transform(({ value }) => parseInt(value))
    limit?: number = 10;

    @ApiProperty({
        example: 'info',
        enum: ['info', 'success', 'warning', 'error'],
        required: false
    })
    @IsOptional()
    @IsEnum(['info', 'success', 'warning', 'error'])
    type?: NotificationType;

    @ApiProperty({ example: false, required: false })
    @IsOptional()
    @Transform(({ value }) => {
        if (value === 'true') return true;
        if (value === 'false') return false;
        return value;
    })
    @IsBoolean()
    read?: boolean;
}

export class NotificationsStateDto implements NotificationsState {
    @ApiProperty({ type: [NotificationDto] })
    items: NotificationDto[];

    @ApiProperty({ example: 5 })
    unreadCount: number;
} 