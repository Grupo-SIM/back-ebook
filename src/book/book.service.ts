import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { RedisService } from 'src/redis.service';
import { CreateBookDto, UpdateBookDto, BookResponseDto, BookQueryDto, PaginatedBookResponseDto, SortOption } from './dto/book.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class BookService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly redisService: RedisService,
    ) { }

    private getSortConfig(sortOption: SortOption, sortBy?: string, sortOrder?: 'asc' | 'desc') {
        // Se sortOption for especificado, usar as configurações predefinidas
        if (sortOption && sortOption !== 'default') {
            switch (sortOption) {
                case 'bestsellers':
                    return { field: 'sales', order: 'desc' as const };
                case 'toprated':
                    return { field: 'rating', order: 'desc' as const };
                case 'price-low':
                    return { field: 'price', order: 'asc' as const };
                case 'price-high':
                    return { field: 'price', order: 'desc' as const };
                default:
                    return { field: 'createdAt', order: 'desc' as const };
            }
        }

        // Se sortBy for especificado, usar ordenação customizada
        if (sortBy) {
            const validSortFields = ['title', 'author', 'price', 'rating', 'sales', 'createdAt'];
            const field = validSortFields.includes(sortBy) ? sortBy : 'createdAt';
            const order = sortOrder || 'desc';
            return { field, order };
        }

        // Padrão: ordenar por data de criação (mais recentes primeiro)
        return { field: 'createdAt', order: 'desc' as const };
    }

    private convertQueryParams(query: BookQueryDto) {
        return {
            page: query.page ? Number(query.page) : 1,
            limit: query.limit ? Number(query.limit) : 10,
            categoryId: query.categoryId ? Number(query.categoryId) : undefined,
            author: query.author,
            minRating: query.minRating ? Number(query.minRating) : undefined,
            maxPrice: query.maxPrice ? Number(query.maxPrice) : undefined,
            minPrice: query.minPrice ? Number(query.minPrice) : undefined,
            sortOption: query.sortOption || 'default',
            sortBy: query.sortBy,
            sortOrder: query.sortOrder || 'desc',
        };
    }

    async createBook(data: CreateBookDto): Promise<BookResponseDto> {
        // Verificar se a categoria existe
        const category = await this.prisma.category.findUnique({
            where: { id: data.categoryId }
        });

        if (!category) {
            throw new NotFoundException('Categoria não encontrada');
        }

        const book = await this.prisma.book.create({
            data: {
                title: data.title,
                author: data.author,
                price: data.price,
                originalPrice: data.originalPrice,
                rating: data.rating,
                reviews: data.reviews,
                category: category.name, // Manter compatibilidade
                categoryId: data.categoryId,
                cover: data.cover,
                description: data.description,
                sales: data.sales,
            },
            include: {
                categoryRef: true,
            },
        });

        await this.invalidateCache('all_books');

        return {
            id: book.id,
            title: book.title,
            author: book.author,
            price: book.price,
            originalPrice: book.originalPrice,
            rating: book.rating,
            reviews: book.reviews,
            categoryId: book.categoryId,
            categoryName: book.category,
            cover: book.cover,
            description: book.description,
            sales: book.sales,
            createdAt: book.createdAt,
            updatedAt: book.updatedAt,
        };
    }

    async getAllBooks(query: BookQueryDto): Promise<PaginatedBookResponseDto> {
        const convertedQuery = this.convertQueryParams(query);
        const {
            page,
            limit,
            categoryId,
            author,
            minRating,
            maxPrice,
            minPrice,
            sortOption,
            sortBy,
            sortOrder
        } = convertedQuery;

        const skip = (page - 1) * limit;

        // Construir condições de filtro
        const where: any = {};

        if (categoryId) {
            where.categoryId = categoryId;
        }

        if (author) {
            where.author = { contains: author, mode: 'insensitive' as Prisma.QueryMode };
        }

        if (minRating !== undefined) {
            where.rating = { gte: minRating };
        }

        if (maxPrice !== undefined) {
            where.price = { ...where.price, lte: maxPrice };
        }

        if (minPrice !== undefined) {
            where.price = { ...where.price, gte: minPrice };
        }

        // Obter configuração de ordenação
        const sortConfig = this.getSortConfig(sortOption, sortBy, sortOrder);

        const [books, total] = await Promise.all([
            this.prisma.book.findMany({
                where,
                include: {
                    categoryRef: true,
                },
                skip,
                take: limit,
                orderBy: { [sortConfig.field]: sortConfig.order },
            }),
            this.prisma.book.count({ where }),
        ]);

        const totalPages = Math.ceil(total / limit);
        const hasNext = page < totalPages;
        const hasPrev = page > 1;

        const data = books.map(book => ({
            id: book.id,
            title: book.title,
            author: book.author,
            price: book.price,
            originalPrice: book.originalPrice,
            rating: book.rating,
            reviews: book.reviews,
            categoryId: book.categoryId,
            categoryName: book.category,
            cover: book.cover,
            description: book.description,
            sales: book.sales,
            createdAt: book.createdAt,
            updatedAt: book.updatedAt,
        }));

        return {
            data,
            page,
            limit,
            total,
            totalPages,
            hasNext,
            hasPrev,
        };
    }

    async getBookById(id: number): Promise<BookResponseDto> {
        const cacheKey = `book:${id}`;
        const cached = await this.redisService.get(cacheKey);

        if (cached) {
            return JSON.parse(cached);
        }

        const book = await this.prisma.book.findUnique({
            where: { id },
            include: {
                categoryRef: true,
            },
        });

        if (!book) {
            throw new NotFoundException('Book not found');
        }

        const response = {
            id: book.id,
            title: book.title,
            author: book.author,
            price: book.price,
            originalPrice: book.originalPrice,
            rating: book.rating,
            reviews: book.reviews,
            categoryId: book.categoryId,
            categoryName: book.category,
            cover: book.cover,
            description: book.description,
            sales: book.sales,
            createdAt: book.createdAt,
            updatedAt: book.updatedAt,
        };

        await this.redisService.set(cacheKey, JSON.stringify(response), 300); // 5 minutos

        return response;
    }

    async getBooksByCategoryId(categoryId: number, query: BookQueryDto): Promise<PaginatedBookResponseDto> {
        const convertedQuery = this.convertQueryParams(query);
        const {
            page,
            limit,
            author,
            minRating,
            maxPrice,
            minPrice,
            sortOption,
            sortBy,
            sortOrder
        } = convertedQuery;

        const skip = (page - 1) * limit;

        // Construir condições de filtro
        const where: any = { categoryId: categoryId };

        if (author) {
            where.author = { contains: author, mode: 'insensitive' as Prisma.QueryMode };
        }

        if (minRating !== undefined) {
            where.rating = { gte: minRating };
        }

        if (maxPrice !== undefined) {
            where.price = { ...where.price, lte: maxPrice };
        }

        if (minPrice !== undefined) {
            where.price = { ...where.price, gte: minPrice };
        }

        // Obter configuração de ordenação
        const sortConfig = this.getSortConfig(sortOption, sortBy, sortOrder);

        const [books, total] = await Promise.all([
            this.prisma.book.findMany({
                where,
                include: {
                    categoryRef: true,
                },
                skip,
                take: limit,
                orderBy: { [sortConfig.field]: sortConfig.order },
            }),
            this.prisma.book.count({ where }),
        ]);

        const totalPages = Math.ceil(total / limit);
        const hasNext = page < totalPages;
        const hasPrev = page > 1;

        const data = books.map(book => ({
            id: book.id,
            title: book.title,
            author: book.author,
            price: book.price,
            originalPrice: book.originalPrice,
            rating: book.rating,
            reviews: book.reviews,
            categoryId: book.categoryId,
            categoryName: book.category,
            cover: book.cover,
            description: book.description,
            sales: book.sales,
            createdAt: book.createdAt,
            updatedAt: book.updatedAt,
        }));

        return {
            data,
            page,
            limit,
            total,
            totalPages,
            hasNext,
            hasPrev,
        };
    }

    async searchBooks(query: string, pagination: BookQueryDto): Promise<PaginatedBookResponseDto> {
        const convertedQuery = this.convertQueryParams(pagination);
        const {
            page,
            limit,
            sortOption,
            sortBy,
            sortOrder
        } = convertedQuery;

        const skip = (page - 1) * limit;

        const where = {
            OR: [
                { title: { contains: query, mode: 'insensitive' as Prisma.QueryMode } },
                { author: { contains: query, mode: 'insensitive' as Prisma.QueryMode } },
                { description: { contains: query, mode: 'insensitive' as Prisma.QueryMode } },
                { category: { contains: query, mode: 'insensitive' as Prisma.QueryMode } },
            ],
        };

        // Obter configuração de ordenação
        const sortConfig = this.getSortConfig(sortOption, sortBy, sortOrder);

        const [books, total] = await Promise.all([
            this.prisma.book.findMany({
                where,
                skip,
                take: limit,
                orderBy: { [sortConfig.field]: sortConfig.order },
            }),
            this.prisma.book.count({ where }),
        ]);

        const totalPages = Math.ceil(total / limit);
        const hasNext = page < totalPages;
        const hasPrev = page > 1;

        const data = books.map(book => ({
            id: book.id,
            title: book.title,
            author: book.author,
            price: book.price,
            originalPrice: book.originalPrice,
            rating: book.rating,
            reviews: book.reviews,
            categoryId: book.categoryId,
            categoryName: book.category,
            cover: book.cover,
            description: book.description,
            sales: book.sales,
            createdAt: book.createdAt,
            updatedAt: book.updatedAt,
        }));

        return {
            data,
            page,
            limit,
            total,
            totalPages,
            hasNext,
            hasPrev,
        };
    }

    async updateBook(id: number, data: UpdateBookDto): Promise<BookResponseDto> {
        const existingBook = await this.prisma.book.findUnique({
            where: { id },
            include: {
                categoryRef: true,
            },
        });

        if (!existingBook) {
            throw new NotFoundException('Book not found');
        }

        // Se categoryId está sendo alterado, verificar se a categoria existe
        if (data.categoryId && data.categoryId !== existingBook.categoryId) {
            const category = await this.prisma.category.findUnique({
                where: { id: data.categoryId }
            });

            if (!category) {
                throw new NotFoundException('Categoria não encontrada');
            }
        }

        const updateData: any = {};

        if (data.title !== undefined) updateData.title = data.title;
        if (data.author !== undefined) updateData.author = data.author;
        if (data.price !== undefined) updateData.price = data.price;
        if (data.originalPrice !== undefined) updateData.originalPrice = data.originalPrice;
        if (data.rating !== undefined) updateData.rating = data.rating;
        if (data.reviews !== undefined) updateData.reviews = data.reviews;
        if (data.categoryId !== undefined) {
            updateData.categoryId = data.categoryId;
            // Atualizar também o nome da categoria para compatibilidade
            if (data.categoryId) {
                const category = await this.prisma.category.findUnique({
                    where: { id: data.categoryId }
                });
                if (category) {
                    updateData.category = category.name;
                }
            }
        }
        if (data.cover !== undefined) updateData.cover = data.cover;
        if (data.description !== undefined) updateData.description = data.description;
        if (data.sales !== undefined) updateData.sales = data.sales;

        const updatedBook = await this.prisma.book.update({
            where: { id },
            data: updateData,
            include: {
                categoryRef: true,
            },
        });

        await this.invalidateCache(`book:${id}`);
        await this.invalidateCache('all_books');

        return {
            id: updatedBook.id,
            title: updatedBook.title,
            author: updatedBook.author,
            price: updatedBook.price,
            originalPrice: updatedBook.originalPrice,
            rating: updatedBook.rating,
            reviews: updatedBook.reviews,
            categoryId: updatedBook.categoryId,
            categoryName: updatedBook.category,
            cover: updatedBook.cover,
            description: updatedBook.description,
            sales: updatedBook.sales,
            createdAt: updatedBook.createdAt,
            updatedAt: updatedBook.updatedAt,
        };
    }

    async deleteBook(id: number): Promise<BookResponseDto> {
        const book = await this.prisma.book.findUnique({
            where: { id },
            include: {
                categoryRef: true,
            },
        });

        if (!book) {
            throw new NotFoundException('Book not found');
        }

        const deletedBook = await this.prisma.book.delete({
            where: { id },
            include: {
                categoryRef: true,
            },
        });

        await this.invalidateCache(`book:${id}`);
        await this.invalidateCache('all_books');

        return {
            id: deletedBook.id,
            title: deletedBook.title,
            author: deletedBook.author,
            price: deletedBook.price,
            originalPrice: deletedBook.originalPrice,
            rating: deletedBook.rating,
            reviews: deletedBook.reviews,
            categoryId: deletedBook.categoryId,
            categoryName: deletedBook.category,
            cover: deletedBook.cover,
            description: deletedBook.description,
            sales: deletedBook.sales,
            createdAt: deletedBook.createdAt,
            updatedAt: deletedBook.updatedAt,
        };
    }

    async getBooksOnSale(query: BookQueryDto): Promise<PaginatedBookResponseDto> {
        const convertedQuery = this.convertQueryParams(query);
        const {
            page,
            limit,
            sortOption,
            sortBy,
            sortOrder
        } = convertedQuery;

        const skip = (page - 1) * limit;

        const where = {
            originalPrice: {
                not: null,
            },
            price: {
                lt: this.prisma.book.fields.originalPrice,
            },
        };

        // Obter configuração de ordenação
        const sortConfig = this.getSortConfig(sortOption, sortBy, sortOrder);

        const [books, total] = await Promise.all([
            this.prisma.book.findMany({
                where,
                include: {
                    categoryRef: true,
                },
                skip,
                take: limit,
                orderBy: { [sortConfig.field]: sortConfig.order },
            }),
            this.prisma.book.count({ where }),
        ]);

        const totalPages = Math.ceil(total / limit);
        const hasNext = page < totalPages;
        const hasPrev = page > 1;

        const data = books.map(book => ({
            id: book.id,
            title: book.title,
            author: book.author,
            price: book.price,
            originalPrice: book.originalPrice,
            rating: book.rating,
            reviews: book.reviews,
            categoryId: book.categoryId,
            categoryName: book.category,
            cover: book.cover,
            description: book.description,
            sales: book.sales,
            createdAt: book.createdAt,
            updatedAt: book.updatedAt,
        }));

        return {
            data,
            page,
            limit,
            total,
            totalPages,
            hasNext,
            hasPrev,
        };
    }

    async getTopSellingBooks(limit: number = 10): Promise<BookResponseDto[]> {
        const books = await this.prisma.book.findMany({
            orderBy: { sales: 'desc' },
            take: limit,
            include: {
                categoryRef: true,
            },
        });

        return books.map(book => ({
            id: book.id,
            title: book.title,
            author: book.author,
            price: book.price,
            originalPrice: book.originalPrice,
            rating: book.rating,
            reviews: book.reviews,
            categoryId: book.categoryId,
            categoryName: book.category,
            cover: book.cover,
            description: book.description,
            sales: book.sales,
            createdAt: book.createdAt,
            updatedAt: book.updatedAt,
        }));
    }

    private async invalidateCache(cacheKey: string) {
        await this.redisService.del(cacheKey);
    }
} 