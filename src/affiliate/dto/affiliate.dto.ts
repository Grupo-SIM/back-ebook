import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsNumber, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class AffiliateMeResponseDto {
    @ApiProperty({ example: 'A1B2C3D4' })
    affiliateCode: string;

    @ApiProperty({ example: 'https://ebooksim.com?ref=A1B2C3D4' })
    affiliateLink: string;

    @ApiProperty({ example: 10 })
    commissionRate: number;

    @ApiProperty({ example: 128.5 })
    totalEarned: number;

    @ApiProperty({ example: 96.5 })
    totalCredited: number;

    @ApiProperty({ example: 3 })
    salesCount: number;
}

export class AffiliateCommissionResponseDto {
    @ApiProperty({ example: 1 })
    id: number;

    @ApiProperty({ example: 1 })
    bookId: number;

    @ApiProperty({ example: 'O Senhor dos Anéis' })
    bookTitle: string;

    @ApiProperty({ example: 1 })
    orderId: number;

    @ApiProperty({ example: 'ORD-2026-000001' })
    orderNumber: string;

    @ApiProperty({ example: 49.9 })
    grossAmount: number;

    @ApiProperty({ example: 10 })
    commissionRate: number;

    @ApiProperty({ example: 4.99 })
    commissionAmount: number;

    @ApiProperty({ example: 'CREDITED' })
    status: string;

    @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
    createdAt: Date;
}

export class PaginatedAffiliateCommissionResponseDto {
    @ApiProperty({ type: [AffiliateCommissionResponseDto] })
    data: AffiliateCommissionResponseDto[];

    @ApiProperty({ example: 1 })
    page: number;

    @ApiProperty({ example: 10 })
    limit: number;

    @ApiProperty({ example: 20 })
    total: number;

    @ApiProperty({ example: 2 })
    totalPages: number;
}

export class AffiliateQueryDto {
    @ApiProperty({ example: 1, default: 1, required: false })
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(1)
    page?: number = 1;

    @ApiProperty({ example: 10, default: 10, required: false })
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(1)
    @Max(100)
    limit?: number = 10;
}
