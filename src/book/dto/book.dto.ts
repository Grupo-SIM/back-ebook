import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNumber, IsOptional, IsUrl, Min, Max, IsEnum, Validate } from 'class-validator';
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

    @ApiProperty({ example: 'senhor dos aneis', required: false, description: 'Busca por título ou autor' })
    @IsOptional()
    @IsString()
    search?: string;

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

    @ApiProperty({ example: 'admin-uuid', required: false, description: 'Filtrar livros pelo admin criador' })
    @IsOptional()
    @IsString()
    createdById?: string;
}

export class CreateBookDto {
    @ApiProperty({ example: 'O Senhor dos Anéis' })
    @IsString()
    title: string;

    @ApiProperty({ example: 'J.R.R. Tolkien' })
    @IsString()
    author: string;

    @ApiProperty({ example: 49.90 })
    @Type(() => Number)
    @IsNumber()
    @Min(0)
    price: number;

    @ApiProperty({ example: 59.90, required: false })
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(0)
    @Validate((o: CreateBookDto) => o.originalPrice === undefined || o.originalPrice === 0 || o.originalPrice > o.price, {
        message: 'O preço base (originalPrice) deve ser maior que o preço promocional (price) se informado.'
    })
    originalPrice?: number;

    @ApiProperty({ example: 4.5, minimum: 0, maximum: 5 })
    @Type(() => Number)
    @IsNumber()
    @Min(0)
    @Max(5)
    rating: number;

    @ApiProperty({ example: 1250 })
    @Type(() => Number)
    @IsNumber()
    @Min(0)
    reviewCount: number;

    @ApiProperty({ example: 1, description: 'ID da categoria' })
    @Type(() => Number)
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
    @Type(() => Number)
    @IsNumber()
    @Min(0)
    sales: number;

    // Novos campos
    @ApiProperty({ example: 'pt-BR', required: false })
    @IsOptional()
    @IsString()
    language?: string;

    @ApiProperty({ example: 'HarperCollins', required: false })
    @IsOptional()
    @IsString()
    publisher?: string;

    @ApiProperty({ example: '1954-07-29', required: false })
    @IsOptional()
    @IsString()
    publishedDate?: string;

    @ApiProperty({ example: 576, required: false })
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    printLength?: number;

    @ApiProperty({ example: '/uploads/books/livro.pdf', required: false })
    @IsOptional()
    @IsString()
    downloadUrl?: string;

    @ApiProperty({ example: '12-16' })
    @IsString()
    readingAge: string;

    @ApiProperty({ example: 1, description: 'Número máximo de parcelas (1 = à vista)', default: 1, required: false })
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(1)
    @Max(12)
    maxInstallments?: number = 1;

    @ApiProperty({ example: true, description: 'Status do livro (ativo/inativo)', default: true })
    @IsOptional()
    isActive?: boolean = true;

    @ApiProperty({ example: false, description: 'Se o livro participa do programa de afiliados', default: false, required: false })
    @IsOptional()
    isAffiliate?: boolean = false;

    @ApiProperty({ example: 10, minimum: 5, maximum: 100, required: false, description: 'Percentual de comissão de afiliado (5 a 100), obrigatório se isAffiliate=true' })
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(5)
    @Max(100)
    commissionRate?: number;
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
    @Type(() => Number) // Garante a conversão de string para número
    @IsNumber()
    @Min(0)
    price?: number;

    @ApiProperty({ example: 59.90, required: false })
    @IsOptional()
    @Type(() => Number) // Garante a conversão de string para número
    @IsNumber()
    @Min(0)
    @Validate((o: UpdateBookDto) => o.originalPrice === undefined || o.originalPrice === 0 || (o.price !== undefined ? o.originalPrice > o.price : true), {
        message: 'O preço base (originalPrice) deve ser maior que o preço promocional (price) se informado.'
    })
    originalPrice?: number;

    @ApiProperty({ example: 4.5, minimum: 0, maximum: 5, required: false })
    @IsOptional()
    @Type(() => Number) // ✅ CORRIGIDO: Adicionado para conversão
    @IsNumber()
    @Min(0)
    @Max(5)
    rating?: number;

    @ApiProperty({ example: 1250, required: false })
    @IsOptional()
    @Type(() => Number) // ✅ CORRIGIDO: Adicionado para conversão
    @IsNumber()
    @Min(0)
    reviewCount?: number;

    @ApiProperty({ example: 1, description: 'ID da categoria', required: false })
    @IsOptional()
    @Type(() => Number) // ✅ CORRIGIDO: Adicionado para conversão
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
    @Type(() => Number) // ✅ CORRIGIDO: Adicionado para conversão
    @IsNumber()
    @Min(0)
    sales?: number;

    @ApiProperty({ example: 'pt-BR', required: false })
    @IsOptional()
    @IsString()
    language?: string;

    @ApiProperty({ example: 'HarperCollins', required: false })
    @IsOptional()
    @IsString()
    publisher?: string;

    @ApiProperty({ example: '1954-07-29', required: false })
    @IsOptional()
    @IsString()
    publishedDate?: string;



    @ApiProperty({ example: 576, required: false })
    @IsOptional()
    @Type(() => Number) // ✅ CORRIGIDO: Adicionado para conversão
    @IsNumber()
    printLength?: number;

    @ApiProperty({ example: '/uploads/books/livro.pdf', required: false })
    @IsOptional()
    @IsString()
    downloadUrl?: string;

    @ApiProperty({ example: '12-16', required: false })
    @IsOptional()
    @IsString()
    readingAge?: string;

    @ApiProperty({ example: 1, description: 'Número máximo de parcelas (1 = à vista)', required: false })
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(1)
    @Max(12)
    maxInstallments?: number;

    @ApiProperty({ example: true, description: 'Status do livro (ativo/inativo)', required: false })
    @IsOptional()
    @Type(() => Boolean) // ✅ CORRIGIDO: Adicionado para converter 'true'/'false' (strings) para booleano
    isActive?: boolean;

    @ApiProperty({ example: false, description: 'Se o livro participa do programa de afiliados', required: false })
    @IsOptional()
    @Type(() => Boolean)
    isAffiliate?: boolean;

    @ApiProperty({ example: 10, minimum: 5, maximum: 100, required: false, description: 'Percentual de comissão de afiliado (5 a 100), obrigatório se isAffiliate=true' })
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(5)
    @Max(100)
    commissionRate?: number;
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

export class BookResponseDto {
    @ApiProperty({ example: 1 })
    id: number;
    @ApiProperty({ example: 'O Senhor dos Anéis' })
    title: string;
    @ApiProperty({ example: 'J.R.R. Tolkien' })
    author: string;
    @ApiProperty({ example: 49.90 })
    price: number;
    @ApiProperty({ example: 59.90, required: false, nullable: true })
    originalPrice?: number;
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
    @ApiProperty({ type: [ReviewResponseDto], required: false, description: 'Lista de reviews do livro' })
    reviews?: ReviewResponseDto[];
    // Novos campos
    @ApiProperty({ example: 'pt-BR', required: false })
    language?: string;
    @ApiProperty({ example: 'HarperCollins', required: false })
    publisher?: string;
    @ApiProperty({ example: '1954-07-29', required: false })
    publishedDate?: string;
    @ApiProperty({ example: 576, required: false })
    printLength?: number;
    @ApiProperty({ example: false, required: true })
    isFree: boolean;

    @ApiProperty({ example: '/uploads/books/livro.pdf', required: false })
    @IsOptional()
    @IsString()
    downloadUrl?: string;

    @ApiProperty({ example: 'https://checkout.jbmidia.com/?value=49.9&description=O Senhor dos Anéis', required: false, description: 'URL de checkout para compra do livro' })
    checkoutUrl?: string;

    @ApiProperty({ example: '12-16', required: false })
    readingAge?: string;

    @ApiProperty({ example: 1, description: 'Número máximo de parcelas', required: false })
    maxInstallments?: number;

    @ApiProperty({ example: true, description: 'Status do livro (ativo/inativo)' })
    isActive: boolean;

    @ApiProperty({ example: false, description: 'Se o livro participa do programa de afiliados' })
    isAffiliate: boolean;

    @ApiProperty({ example: 10, required: false, nullable: true, description: 'Percentual de comissão de afiliado definido pelo criador do livro' })
    commissionRate?: number | null;
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
