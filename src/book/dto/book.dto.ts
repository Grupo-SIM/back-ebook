import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNumber, IsOptional, IsUrl, Min, Max, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';

export type SortOption = 'default' | 'bestsellers' | 'toprated' | 'price-low' | 'price-high';

export class PaginationDto {
    @ApiProperty({ example: 1, default: 1, minimum: 1 })
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(1)
    page?: number = 1;

    @ApiProperty({ example: 10, default: 10, minimum: 1, maximum: 100 })
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(1)
    @Max(100)
    limit?: number = 10;
}

export class BookQueryDto extends PaginationDto {
    @ApiProperty({ example: 1, description: 'ID da categoria', required: false })
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(1)
    categoryId?: number;

    @ApiProperty({ example: 'tolkien', required: false })
    @IsOptional()
    @IsString()
    author?: string;

    @ApiProperty({ example: 4.0, required: false })
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(0)
    @Max(5)
    minRating?: number;

    @ApiProperty({ example: 50.0, required: false })
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(0)
    maxPrice?: number;

    @ApiProperty({
        example: 0.0,
        required: false,
        description: 'Preço mínimo (0 para incluir livros gratuitos)',
        default: 0
    })
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(0)
    minPrice?: number = 0;

    @ApiProperty({
        example: 'default',
        enum: ['default', 'bestsellers', 'toprated', 'price-low', 'price-high'],
        required: false,
        description: 'Opção de ordenação específica'
    })
    @IsOptional()
    @IsEnum(['default', 'bestsellers', 'toprated', 'price-low', 'price-high'])
    sortOption?: SortOption = 'default';

    @ApiProperty({
        example: 'title',
        enum: ['title', 'author', 'price', 'rating', 'sales', 'createdAt'],
        required: false,
        description: 'Campo para ordenação customizada'
    })
    @IsOptional()
    @IsString()
    sortBy?: string;

    @ApiProperty({ example: 'desc', enum: ['asc', 'desc'], required: false })
    @IsOptional()
    @IsString()
    sortOrder?: 'asc' | 'desc' = 'desc';

    @ApiProperty({
        example: 'all',
        enum: ['all', 'paid', 'free'],
        required: false,
        description: 'Filtrar por tipo de livro: all (todos), paid (pagos), free (gratuitos)'
    })
    @IsOptional()
    @IsEnum(['all', 'paid', 'free'])
    type?: 'all' | 'paid' | 'free' = 'all';
}

export class CreateBookDto {
    @ApiProperty({ example: 'O Senhor dos Anéis' })
    @IsString()
    title: string;

    @ApiProperty({ example: 'J.R.R. Tolkien' })
    @IsString()
    author: string;

    @ApiProperty({ example: 49.90 })
    @IsNumber()
    @Min(0)
    price: number;

    @ApiProperty({ example: 59.90, required: false })
    @IsOptional()
    @IsNumber()
    @Min(0)
    originalPrice?: number;

    @ApiProperty({ example: 4.5, minimum: 0, maximum: 5 })
    @IsNumber()
    @Min(0)
    @Max(5)
    rating: number;

    @ApiProperty({ example: 1250 })
    @IsNumber()
    @Min(0)
    reviewCount: number;

    @ApiProperty({ example: 1, description: 'ID da categoria' })
    @IsNumber()
    @Min(1)
    categoryId: number;

    @ApiProperty({ example: 'https://example.com/cover.jpg' })
    @IsUrl()
    cover: string;

    @ApiProperty({ example: 'Uma épica jornada pela Terra-média...' })
    @IsString()
    description: string;

    @ApiProperty({ example: 5000 })
    @IsNumber()
    @Min(0)
    sales: number;
}

export class UpdateBookDto {
    @ApiProperty({ example: 'O Senhor dos Anéis', required: false })
    @IsOptional()
    @IsString()
    title?: string;

    @ApiProperty({ example: 'J.R.R. Tolkien', required: false })
    @IsOptional()
    @IsString()
    author?: string;

    @ApiProperty({ example: 49.90, required: false })
    @IsOptional()
    @IsNumber()
    @Min(0)
    price?: number;

    @ApiProperty({ example: 59.90, required: false })
    @IsOptional()
    @IsNumber()
    @Min(0)
    originalPrice?: number;

    @ApiProperty({ example: 4.5, minimum: 0, maximum: 5, required: false })
    @IsOptional()
    @IsNumber()
    @Min(0)
    @Max(5)
    rating?: number;

    @ApiProperty({ example: 1250, required: false })
    @IsOptional()
    @IsNumber()
    @Min(0)
    reviewCount?: number;

    @ApiProperty({ example: 1, description: 'ID da categoria', required: false })
    @IsOptional()
    @IsNumber()
    @Min(1)
    categoryId?: number;

    @ApiProperty({ example: 'https://example.com/cover.jpg', required: false })
    @IsOptional()
    @IsUrl()
    cover?: string;

    @ApiProperty({ example: 'Uma épica jornada pela Terra-média...', required: false })
    @IsOptional()
    @IsString()
    description?: string;

    @ApiProperty({ example: 5000, required: false })
    @IsOptional()
    @IsNumber()
    @Min(0)
    sales?: number;
}

export class BookResponseDto {
    @ApiProperty({ example: 1 })
    id: number;

    @ApiProperty({ example: 'O Senhor dos Anéis' })
    title: string;

    @ApiProperty({ example: 'J.R.R. Tolkien' })
    author: string;

    @ApiProperty({ example: 49.90 })
    price: number;

    @ApiProperty({ example: 59.90, nullable: true })
    originalPrice: number | null;

    @ApiProperty({ example: 4.5 })
    rating: number;

    @ApiProperty({ example: 1250 })
    reviewCount: number;

    @ApiProperty({ example: 1 })
    categoryId: number;

    @ApiProperty({ example: 'Fantasia' })
    categoryName: string;

    @ApiProperty({ example: 'https://example.com/cover.jpg' })
    cover: string;

    @ApiProperty({ example: 'Uma épica jornada pela Terra-média...' })
    description: string;

    @ApiProperty({ example: 5000 })
    sales: number;

    @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
    createdAt: Date;

    @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
    updatedAt: Date;

    @ApiProperty({ example: 12, description: 'Quantidade de usuários que favoritaram este livro' })
    favoritesCount: number;

    @ApiProperty({ example: 3, description: 'Quantidade de vezes que este livro está no carrinho de usuários' })
    cartCount: number;

    @ApiProperty({ example: true, required: false, description: 'Se o livro está nos favoritos do usuário autenticado' })
    isFavorite?: boolean;

    @ApiProperty({ example: 2, required: false, description: 'Quantidade deste livro no carrinho do usuário autenticado' })
    cartQuantity?: number;
}

export class PaginatedBookResponseDto {
    @ApiProperty({ type: [BookResponseDto] })
    data: BookResponseDto[];

    @ApiProperty({ example: 1 })
    page: number;

    @ApiProperty({ example: 10 })
    limit: number;

    @ApiProperty({ example: 100 })
    total: number;

    @ApiProperty({ example: 10 })
    totalPages: number;

    @ApiProperty({ example: true })
    hasNext: boolean;

    @ApiProperty({ example: false })
    hasPrev: boolean;
}

export class CreateReviewDto {
    @ApiProperty({ example: 5, minimum: 1, maximum: 5, required: false })
    @IsOptional()
    @IsNumber()
    @Min(1)
    @Max(5)
    rating?: number;

    @ApiProperty({ example: 'Excelente livro, recomendo!', required: false })
    @IsOptional()
    @IsString()
    comment?: string;
}

export class ReviewResponseDto {
    @ApiProperty({ example: 1 })
    id: number;

    @ApiProperty({ example: 5 })
    rating: number;

    @ApiProperty({ example: 'Excelente livro, recomendo!' })
    comment: string;

    @ApiProperty({ example: '2024-07-16T15:00:00.000Z' })
    createdAt: Date;

    @ApiProperty({ example: '2024-07-16T15:00:00.000Z' })
    updatedAt: Date;

    @ApiProperty({ example: 'user-id-uuid' })
    userId: string;

    @ApiProperty({ example: 'João da Silva' })
    userName: string;

    @ApiProperty({ example: 'https://example.com/avatar.jpg', required: false })
    userAvatar?: string;
}

export class PaginatedReviewsResponseDto {
    @ApiProperty({ type: [ReviewResponseDto] })
    reviews: ReviewResponseDto[];

    @ApiProperty({ example: 1 })
    page: number;

    @ApiProperty({ example: 10 })
    limit: number;

    @ApiProperty({ example: 100 })
    total: number;

    @ApiProperty({ example: 10 })
    totalPages: number;
} 