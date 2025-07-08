import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsEnum, IsString } from 'class-validator';
import { Type } from 'class-transformer';

export type FavoriteSortBy = 'recent' | 'alphabetical' | 'price-low' | 'price-high' | 'rating';

export class AddFavoriteDto {
    @ApiProperty({ example: 1, description: 'ID do livro' })
    @IsNumber()
    @Type(() => Number)
    bookId: number;
}

export class RemoveFavoriteDto {
    @ApiProperty({ example: 1, description: 'ID do livro' })
    @IsNumber()
    @Type(() => Number)
    bookId: number;
}

export class FavoriteQueryDto {
    @ApiProperty({
        example: 'recent',
        enum: ['recent', 'alphabetical', 'price-low', 'price-high', 'rating'],
        required: false,
        description: 'Ordenação dos favoritos'
    })
    @IsOptional()
    @IsEnum(['recent', 'alphabetical', 'price-low', 'price-high', 'rating'])
    sortBy?: FavoriteSortBy = 'recent';

    @ApiProperty({
        example: 'Fantasia',
        required: false,
        description: 'Filtrar por categoria'
    })
    @IsOptional()
    @IsString()
    filterCategory?: string;

    @ApiProperty({ example: 1, required: false })
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    page?: number = 1;

    @ApiProperty({ example: 10, required: false })
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    limit?: number = 10;
}

export class FavoriteItemDto {
    @ApiProperty({ example: 1 })
    id: number;

    @ApiProperty({ example: 1 })
    bookId: number;

    @ApiProperty({ example: 'O Senhor dos Anéis' })
    bookTitle: string;

    @ApiProperty({ example: 'J.R.R. Tolkien' })
    bookAuthor: string;

    @ApiProperty({ example: 49.90 })
    bookPrice: number;

    @ApiProperty({ example: 59.90, nullable: true })
    bookOriginalPrice: number | null;

    @ApiProperty({ example: 4.5 })
    bookRating: number;

    @ApiProperty({ example: 1250 })
    bookReviews: number;

    @ApiProperty({ example: 1 })
    bookCategoryId: number;

    @ApiProperty({ example: 'Fantasia' })
    bookCategoryName: string;

    @ApiProperty({ example: 'https://example.com/cover.jpg' })
    bookCover: string;

    @ApiProperty({ example: 'Uma épica jornada pela Terra-média...' })
    bookDescription: string;

    @ApiProperty({ example: 5000 })
    bookSales: number;

    @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
    bookCreatedAt: Date;

    @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
    bookUpdatedAt: Date;

    @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
    addedAt: Date;
}

export class FavoritesResponseDto {
    @ApiProperty({ type: [FavoriteItemDto] })
    items: FavoriteItemDto[];

    @ApiProperty({ example: 5 })
    count: number;

    @ApiProperty({ example: 1 })
    page: number;

    @ApiProperty({ example: 10 })
    limit: number;

    @ApiProperty({ example: 5 })
    total: number;

    @ApiProperty({ example: 1 })
    totalPages: number;

    @ApiProperty({ example: false })
    hasNext: boolean;

    @ApiProperty({ example: false })
    hasPrev: boolean;
}

export class FavoriteStatusDto {
    @ApiProperty({ example: true })
    isFavorite: boolean;

    @ApiProperty({ example: '2024-01-01T00:00:00.000Z', nullable: true })
    addedAt?: Date;
} 