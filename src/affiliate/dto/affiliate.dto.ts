import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsNumber, IsString, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class AffiliateMeResponseDto {
    @ApiProperty({ example: 'A1B2C3D4' })
    affiliateCode: string;

    @ApiProperty({ example: 'https://ebooksim.com?ref=A1B2C3D4' })
    affiliateLink: string;

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

    @ApiProperty({ example: true, description: 'true se a comissão foi ganha pelo próprio admin autenticado; false se foi ganha por outro afiliado vendendo um livro dele' })
    isMine: boolean;

    @ApiProperty({ example: 'Gabriel Souza', nullable: true, description: 'Nome de quem ganhou a comissão (o afiliado que vendeu)' })
    affiliateName: string | null;
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

export class AffiliateMarketplaceQueryDto extends AffiliateQueryDto {
    @ApiProperty({ example: 'Senhor dos Anéis', required: false })
    @IsOptional()
    @IsString()
    search?: string;

    @ApiProperty({ example: 'Negócios', required: false, description: 'Filtra por categoria exata do livro' })
    @IsOptional()
    @IsString()
    category?: string;

    @ApiProperty({
        example: 'default',
        required: false,
        enum: ['default', 'bestsellers', 'toprated', 'price-low', 'price-high'],
    })
    @IsOptional()
    @IsString()
    sortOption?: 'default' | 'bestsellers' | 'toprated' | 'price-low' | 'price-high';
}

export class AffiliateMarketplaceProductLinkDto {
    @ApiProperty({ example: 'A1B2C3D4' })
    code: string;

    @ApiProperty({ example: 'https://ebooksim.com/book/1?refp=A1B2C3D4' })
    link: string;
}

export class AffiliateMarketplaceBookResponseDto {
    @ApiProperty({ example: 1 })
    bookId: number;

    @ApiProperty({ example: 'O Senhor dos Anéis' })
    title: string;

    @ApiProperty({ example: 'J.R.R. Tolkien' })
    author: string;

    @ApiProperty({ example: 'https://example.com/cover.jpg' })
    cover: string;

    @ApiProperty({ example: 'Negócios' })
    category: string;

    @ApiProperty({ example: 49.9 })
    price: number;

    @ApiProperty({ example: 'João Silva', nullable: true })
    ownerName: string | null;

    @ApiProperty({ example: 10 })
    commissionRate: number;

    @ApiProperty({ example: false })
    hasLink: boolean;

    @ApiProperty({ type: AffiliateMarketplaceProductLinkDto, nullable: true })
    productLink: AffiliateMarketplaceProductLinkDto | null;

    @ApiProperty({ example: false })
    isFavorite: boolean;
}

export class PaginatedAffiliateMarketplaceBookResponseDto {
    @ApiProperty({ type: [AffiliateMarketplaceBookResponseDto] })
    data: AffiliateMarketplaceBookResponseDto[];

    @ApiProperty({ example: 1 })
    page: number;

    @ApiProperty({ example: 10 })
    limit: number;

    @ApiProperty({ example: 20 })
    total: number;

    @ApiProperty({ example: 2 })
    totalPages: number;
}

export class AffiliateFavoriteBookResponseDto {
    @ApiProperty({ example: 1 })
    bookId: number;

    @ApiProperty({ example: 'O Senhor dos Anéis' })
    title: string;

    @ApiProperty({ example: 'J.R.R. Tolkien' })
    author: string;

    @ApiProperty({ example: 'https://example.com/cover.jpg' })
    cover: string;

    @ApiProperty({ example: 'Negócios' })
    category: string;

    @ApiProperty({ example: 49.9 })
    price: number;

    @ApiProperty({ example: 'João Silva', nullable: true })
    ownerName: string | null;

    @ApiProperty({ example: 10 })
    commissionRate: number;

    @ApiProperty({ example: false })
    hasLink: boolean;

    @ApiProperty({ type: AffiliateMarketplaceProductLinkDto, nullable: true })
    productLink: AffiliateMarketplaceProductLinkDto | null;
}

export class PaginatedAffiliateFavoriteResponseDto {
    @ApiProperty({ type: [AffiliateFavoriteBookResponseDto] })
    data: AffiliateFavoriteBookResponseDto[];

    @ApiProperty({ example: 1 })
    page: number;

    @ApiProperty({ example: 10 })
    limit: number;

    @ApiProperty({ example: 20 })
    total: number;

    @ApiProperty({ example: 2 })
    totalPages: number;
}

export class AffiliateFavoriteToggleResponseDto {
    @ApiProperty({ example: true })
    isFavorite: boolean;
}

export class AffiliateProductLinkResponseDto {
    @ApiProperty({ example: 1 })
    bookId: number;

    @ApiProperty({ example: 'A1B2C3D4' })
    code: string;

    @ApiProperty({ example: 'https://ebooksim.com/book/1?refp=A1B2C3D4' })
    link: string;

    @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
    createdAt: Date;
}
