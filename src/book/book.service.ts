import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { RedisService } from 'src/redis.service';
import { CreateBookDto, UpdateBookDto, BookResponseDto, BookQueryDto, PaginatedBookResponseDto, SortOption, CreateReviewDto, ReviewResponseDto, PaginatedReviewsResponseDto } from './dto/book.dto';
import { Prisma } from '@prisma/client';
import { FavoriteService } from '../favorite/favorite.service';
import { CheckoutService } from '../checkout/checkout.service';

@Injectable()
export class BookService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly redisService: RedisService,
        private readonly favoriteService: FavoriteService,
        private readonly checkoutService: CheckoutService,
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
            minPrice: query.minPrice !== undefined ? Number(query.minPrice) : 0, // Padrão 0 para incluir gratuitos
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

        // Determinar se o livro é gratuito baseado no preço
        const isFree = data.price === 0;

        const book = await this.prisma.book.create({
            data: {
                title: data.title,
                author: data.author,
                price: data.price,
                originalPrice: data.originalPrice,
                rating: data.rating,
                category: category.name, // Manter compatibilidade
                categoryId: data.categoryId,
                cover: data.cover,
                description: data.description,
                sales: data.sales,
                isFree: isFree, // Definir corretamente se é gratuito
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
            reviewCount: book.reviewCount,
            categoryId: book.categoryId,
            categoryName: book.category,
            cover: book.cover,
            description: book.description,
            sales: book.sales,
            createdAt: book.createdAt,
            updatedAt: book.updatedAt,
            favoritesCount: 0,
            cartCount: 0,
            isFavorite: undefined,
            cartQuantity: undefined,
        };
    }

    async getAllBooks(query: BookQueryDto, userId?: string): Promise<PaginatedBookResponseDto> {
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
            sortOrder,
            type
        } = { ...convertedQuery, type: query.type };

        const skip = (page - 1) * limit;

        // Construir condições de filtro
        const where: any = {
            isActive: true // Mostrar apenas livros ativos
        };

        if (categoryId) {
            where.categoryId = categoryId;
        }

        if (author) {
            where.author = { contains: author, mode: 'insensitive' };
        }

        if (minRating !== undefined) {
            where.rating = { gte: minRating };
        }

        // Construir filtros de preço de forma mais robusta
        if (minPrice !== undefined || maxPrice !== undefined) {
            where.price = {};

            if (minPrice !== undefined) {
                where.price.gte = minPrice;
            }

            if (maxPrice !== undefined) {
                where.price.lte = maxPrice;
            }
        }

        if (type === 'free') {
            where.isFree = true;
        } else if (type === 'paid') {
            where.isFree = false;
        }

        // Obter configuração de ordenação
        const sortConfig = this.getSortConfig(sortOption, sortBy, sortOrder);

        const [books, total] = await Promise.all([
            this.prisma.book.findMany({
                where,
                include: {
                    categoryRef: true,
                    reviews: {
                        include: { user: true },
                        orderBy: { createdAt: 'desc' },
                    },
                },
                skip,
                take: limit,
                orderBy: { [sortConfig.field]: sortConfig.order },
            }),
            this.prisma.book.count({ where }),
        ]);

        // Buscar favoritos e carrinho em lote
        const bookIds = books.map(b => b.id);
        const [favoritesCounts, cartCounts, userFavorites, userCart] = await Promise.all([
            this.prisma.favorite.groupBy({
                by: ['bookId'],
                where: { bookId: { in: bookIds } },
                _count: { bookId: true },
            }),
            this.prisma.cart.groupBy({
                by: ['bookId'],
                where: { bookId: { in: bookIds } },
                _count: { bookId: true },
            }),
            userId ? this.prisma.favorite.findMany({ where: { userId, bookId: { in: bookIds } } }) : Promise.resolve([]),
            userId ? this.prisma.cart.findMany({ where: { userId, bookId: { in: bookIds } } }) : Promise.resolve([]),
        ]);
        const favCountMap = Object.fromEntries(favoritesCounts.map(f => [f.bookId, f._count.bookId]));
        const cartCountMap = Object.fromEntries(cartCounts.map(c => [c.bookId, c._count.bookId]));
        const userFavSet = new Set(userFavorites.map(f => f.bookId));
        const userCartMap = Object.fromEntries(userCart.map(c => [c.bookId, c.quantity]));

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
            reviewCount: book.reviewCount,
            categoryId: book.categoryId,
            categoryName: book.category,
            cover: book.cover,
            description: book.description,
            sales: book.sales,
            createdAt: book.createdAt,
            updatedAt: book.updatedAt,
            favoritesCount: favCountMap[book.id] || 0,
            cartCount: cartCountMap[book.id] || 0,
            isFavorite: userId ? userFavSet.has(book.id) : undefined,
            cartQuantity: userId ? userCartMap[book.id] || 0 : undefined,
            reviews: (book.reviews || []).map(r => ({
                id: r.id,
                rating: r.rating,
                comment: r.comment,
                createdAt: r.createdAt,
                updatedAt: r.updatedAt,
                userId: r.userId,
                userName: r.user?.name || '',
            })),
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

    async getBookById(id: number, userId?: string): Promise<BookResponseDto> {
        const cacheKey = `book:${id}`;
        const cached = await this.redisService.get(cacheKey);

        const book = await this.prisma.book.findUnique({
            where: { id },
            include: {
                categoryRef: true,
            },
        });

        if (!book) {
            throw new NotFoundException('Book not found');
        }

        // Buscar reviews do livro (com nome do usuário)
        const reviews = await this.prisma.review.findMany({
            where: { bookId: id },
            orderBy: { createdAt: 'desc' },
            include: { user: true },
        });
        const mappedReviews = reviews.map(r => ({
            id: r.id,
            rating: r.rating,
            comment: r.comment,
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
            userId: r.userId,
            userName: r.user?.name || '',
        }));

        // Agregados
        const [favoritesCount, cartCount, isFavorite, cartQuantity] = await Promise.all([
            this.prisma.favorite.count({ where: { bookId: id } }),
            this.prisma.cart.count({ where: { bookId: id } }),
            userId ? this.prisma.favorite.findFirst({ where: { userId, bookId: id } }) : Promise.resolve(undefined),
            userId ? this.prisma.cart.findFirst({ where: { userId, bookId: id } }) : Promise.resolve(undefined),
        ]);

        const response = {
            id: book.id,
            title: book.title,
            author: book.author,
            price: book.price,
            originalPrice: book.originalPrice,
            rating: book.rating,
            reviewCount: book.reviewCount,
            categoryId: book.categoryId,
            categoryName: book.category,
            cover: book.cover,
            description: book.description,
            sales: book.sales,
            createdAt: book.createdAt,
            updatedAt: book.updatedAt,
            favoritesCount,
            cartCount,
            isFavorite: userId ? !!isFavorite : undefined,
            cartQuantity: userId && cartQuantity ? cartQuantity.quantity : undefined,
            reviews: mappedReviews,
        };

        return response;
    }

    async getBooksByCategoryId(categoryId: number, query: BookQueryDto, userId?: string): Promise<PaginatedBookResponseDto> {
        // Mesma lógica de agregação do getAllBooks
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
            sortOrder,
            type
        } = { ...convertedQuery, type: query.type };

        const skip = (page - 1) * limit;

        // Construir condições de filtro
        const where: any = { categoryId: categoryId };

        if (author) {
            where.author = { contains: author, mode: 'insensitive' };
        }

        if (minRating !== undefined) {
            where.rating = { gte: minRating };
        }

        // Construir filtros de preço de forma mais robusta
        if (minPrice !== undefined || maxPrice !== undefined) {
            where.price = {};

            if (minPrice !== undefined) {
                where.price.gte = minPrice;
            }

            if (maxPrice !== undefined) {
                where.price.lte = maxPrice;
            }
        }

        if (type === 'free') {
            where.isFree = true;
        } else if (type === 'paid') {
            where.isFree = false;
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

        const bookIds = books.map(b => b.id);
        const [favoritesCounts, cartCounts, userFavorites, userCart] = await Promise.all([
            this.prisma.favorite.groupBy({
                by: ['bookId'],
                where: { bookId: { in: bookIds } },
                _count: { bookId: true },
            }),
            this.prisma.cart.groupBy({
                by: ['bookId'],
                where: { bookId: { in: bookIds } },
                _count: { bookId: true },
            }),
            userId ? this.prisma.favorite.findMany({ where: { userId, bookId: { in: bookIds } } }) : Promise.resolve([]),
            userId ? this.prisma.cart.findMany({ where: { userId, bookId: { in: bookIds } } }) : Promise.resolve([]),
        ]);
        const favCountMap = Object.fromEntries(favoritesCounts.map(f => [f.bookId, f._count.bookId]));
        const cartCountMap = Object.fromEntries(cartCounts.map(c => [c.bookId, c._count.bookId]));
        const userFavSet = new Set(userFavorites.map(f => f.bookId));
        const userCartMap = Object.fromEntries(userCart.map(c => [c.bookId, c.quantity]));

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
            reviewCount: book.reviewCount,
            categoryId: book.categoryId,
            categoryName: book.category,
            cover: book.cover,
            description: book.description,
            sales: book.sales,
            createdAt: book.createdAt,
            updatedAt: book.updatedAt,
            favoritesCount: favCountMap[book.id] || 0,
            cartCount: cartCountMap[book.id] || 0,
            isFavorite: userId ? userFavSet.has(book.id) : undefined,
            cartQuantity: userId ? (userCartMap[book.id] || 0) : undefined,
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

    async searchBooks(query: string, pagination: BookQueryDto, userId?: string): Promise<PaginatedBookResponseDto> {
        // Mesma lógica de agregação do getAllBooks
        const convertedQuery = this.convertQueryParams(pagination);
        const {
            page,
            limit,
            sortOption,
            sortBy,
            sortOrder,
            type
        } = { ...convertedQuery, type: pagination.type };

        const skip = (page - 1) * limit;

        const where: any = {
            OR: [
                { title: { contains: query, mode: 'insensitive' } },
                { author: { contains: query, mode: 'insensitive' } },
                { description: { contains: query, mode: 'insensitive' } },
                { category: { contains: query, mode: 'insensitive' } },
            ],
        };

        if (type === 'free') {
            where.isFree = true;
        } else if (type === 'paid') {
            where.isFree = false;
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

        const bookIds = books.map(b => b.id);
        const [favoritesCounts, cartCounts, userFavorites, userCart] = await Promise.all([
            this.prisma.favorite.groupBy({
                by: ['bookId'],
                where: { bookId: { in: bookIds } },
                _count: { bookId: true },
            }),
            this.prisma.cart.groupBy({
                by: ['bookId'],
                where: { bookId: { in: bookIds } },
                _count: { bookId: true },
            }),
            userId ? this.prisma.favorite.findMany({ where: { userId, bookId: { in: bookIds } } }) : Promise.resolve([]),
            userId ? this.prisma.cart.findMany({ where: { userId, bookId: { in: bookIds } } }) : Promise.resolve([]),
        ]);
        const favCountMap = Object.fromEntries(favoritesCounts.map(f => [f.bookId, f._count.bookId]));
        const cartCountMap = Object.fromEntries(cartCounts.map(c => [c.bookId, c._count.bookId]));
        const userFavSet = new Set(userFavorites.map(f => f.bookId));
        const userCartMap = Object.fromEntries(userCart.map(c => [c.bookId, c.quantity]));

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
            reviewCount: book.reviewCount,
            categoryId: book.categoryId,
            categoryName: book.category,
            cover: book.cover,
            description: book.description,
            sales: book.sales,
            createdAt: book.createdAt,
            updatedAt: book.updatedAt,
            favoritesCount: favCountMap[book.id] || 0,
            cartCount: cartCountMap[book.id] || 0,
            isFavorite: userId ? userFavSet.has(book.id) : undefined,
            cartQuantity: userId ? (userCartMap[book.id] || 0) : undefined,
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
        if (data.reviewCount !== undefined) updateData.reviewCount = data.reviewCount;
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
            reviewCount: updatedBook.reviewCount,
            categoryId: updatedBook.categoryId,
            categoryName: updatedBook.category,
            cover: updatedBook.cover,
            description: updatedBook.description,
            sales: updatedBook.sales,
            createdAt: updatedBook.createdAt,
            updatedAt: updatedBook.updatedAt,
            favoritesCount: 0,
            cartCount: 0,
            isFavorite: undefined,
            cartQuantity: undefined,
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
            reviewCount: deletedBook.reviewCount,
            categoryId: deletedBook.categoryId,
            categoryName: deletedBook.category,
            cover: deletedBook.cover,
            description: deletedBook.description,
            sales: deletedBook.sales,
            createdAt: deletedBook.createdAt,
            updatedAt: deletedBook.updatedAt,
            favoritesCount: 0,
            cartCount: 0,
            isFavorite: undefined,
            cartQuantity: undefined,
        };
    }

    // --- Métodos removidos pelo modelo anterior, reinseridos e corrigidos ---

    async getBooksOnSale(query: BookQueryDto): Promise<PaginatedBookResponseDto> {
        const convertedQuery = this.convertQueryParams(query);
        const { page, limit, sortOption, sortBy, sortOrder } = convertedQuery;
        const skip = (page - 1) * limit;
        const where = {
            originalPrice: { not: null },
            price: { lt: undefined }, // Corrija conforme sua lógica de preço promocional
        };
        const sortConfig = this.getSortConfig(sortOption, sortBy, sortOrder);
        const [books, total] = await Promise.all([
            this.prisma.book.findMany({
                where,
                include: { categoryRef: true },
                skip,
                take: limit,
                orderBy: { [sortConfig.field]: sortConfig.order },
            }),
            this.prisma.book.count({ where }),
        ]);
        const data = books.map(book => ({
            id: book.id,
            title: book.title,
            author: book.author,
            price: book.price,
            originalPrice: book.originalPrice,
            rating: book.rating,
            reviewCount: book.reviewCount,
            categoryId: book.categoryId,
            categoryName: book.category,
            cover: book.cover,
            description: book.description,
            sales: book.sales,
            createdAt: book.createdAt,
            updatedAt: book.updatedAt,
            favoritesCount: 0,
            cartCount: 0,
            isFavorite: undefined,
            cartQuantity: undefined,
        }));
        const totalPages = Math.ceil(total / limit);
        const hasNext = page < totalPages;
        const hasPrev = page > 1;
        return { data, page, limit, total, totalPages, hasNext, hasPrev };
    }

    async getTopSellingBooks(limit: number = 10): Promise<BookResponseDto[]> {
        const books = await this.prisma.book.findMany({
            orderBy: { sales: 'desc' },
            take: limit,
            include: { categoryRef: true },
        });
        return books.map(book => ({
            id: book.id,
            title: book.title,
            author: book.author,
            price: book.price,
            originalPrice: book.originalPrice,
            rating: book.rating,
            reviewCount: book.reviewCount,
            categoryId: book.categoryId,
            categoryName: book.category,
            cover: book.cover,
            description: book.description,
            sales: book.sales,
            createdAt: book.createdAt,
            updatedAt: book.updatedAt,
            favoritesCount: 0,
            cartCount: 0,
            isFavorite: undefined,
            cartQuantity: undefined,
        }));
    }

    async createReview(bookId: number, userId: string, dto: CreateReviewDto): Promise<ReviewResponseDto> {
        // Verificar se o usuário comprou o livro
        const orderItem = await this.prisma.orderItem.findFirst({
            where: {
                bookId,
                order: {
                    is: {
                        userId,
                        status: 'paid',
                    }
                },
            },
            include: { order: true },
        });
        if (!orderItem) {
            throw new ConflictException('Você só pode avaliar livros que comprou.');
        }
        // Só pode um review por user/livro
        const existing = await this.prisma.review.findUnique({
            where: { userId_bookId: { userId, bookId } },
        });
        // Permitir rating, comment, ou ambos, mas pelo menos um deve ser enviado
        if (
            (dto.rating === undefined || dto.rating === null) &&
            (!dto.comment || dto.comment.trim() === '')
        ) {
            throw new ConflictException('É necessário enviar pelo menos um rating ou um comentário.');
        }
        let review;
        if (existing) {
            review = await this.prisma.review.update({
                where: { id: existing.id },
                data: {
                    ...(dto.rating !== undefined ? { rating: dto.rating } : {}),
                    ...(dto.comment !== undefined ? { comment: dto.comment } : {}),
                } as any,
            });
        } else {
            review = await this.prisma.review.create({
                data: {
                    userId: userId,
                    bookId: bookId,
                    ...(dto.rating !== undefined ? { rating: dto.rating } : {}),
                    ...(dto.comment !== undefined ? { comment: dto.comment } : {}),
                } as any,
            });
        }
        // Atualizar reviewCount e rating médio do livro
        const [count, avg] = await Promise.all([
            this.prisma.review.count({ where: { bookId } }),
            this.prisma.review.aggregate({ where: { bookId }, _avg: { rating: true } }),
        ]);
        await this.prisma.book.update({
            where: { id: bookId },
            data: { reviewCount: count, rating: avg._avg.rating || 0 },
        });
        // Buscar dados do usuário
        const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { Image: true } });
        return {
            id: review.id,
            rating: review.rating,
            comment: review.comment,
            createdAt: review.createdAt,
            updatedAt: review.updatedAt,
            userId: review.userId,
            userName: user?.name || '',
            userAvatar: user?.Image?.[0]?.url,
        };
    }

    async getReviews(bookId: number, page = 1, limit = 10): Promise<PaginatedReviewsResponseDto> {
        const skip = (page - 1) * limit;
        const [reviews, total] = await Promise.all([
            this.prisma.review.findMany({
                where: { bookId },
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit,
                include: { user: { include: { Image: true } } },
            }),
            this.prisma.review.count({ where: { bookId } }),
        ]);
        const totalPages = Math.ceil(total / limit);
        return {
            reviews: reviews.map(r => ({
                id: r.id,
                rating: r.rating,
                comment: r.comment,
                createdAt: r.createdAt,
                updatedAt: r.updatedAt,
                userId: r.userId,
                userName: r.user?.name || '',
                userAvatar: r.user?.Image?.[0]?.url,
            })),
            page,
            limit,
            total,
            totalPages,
        };
    }

    async getPurchasedBooks(query: BookQueryDto, userId: string): Promise<PaginatedBookResponseDto> {
        const convertedQuery = this.convertQueryParams(query);
        const { page, limit, sortOption, sortBy, sortOrder } = convertedQuery;
        const skip = (page - 1) * limit;

        // Buscar todos os bookIds comprados pelo usuário
        const purchasedItems = await this.prisma.orderItem.findMany({
            where: {
                order: {
                    userId,
                    status: 'paid',
                },
            },
            select: { bookId: true },
        });
        const bookIds = purchasedItems.map(item => item.bookId);
        if (bookIds.length === 0) {
            return {
                data: [],
                page,
                limit,
                total: 0,
                totalPages: 0,
                hasNext: false,
                hasPrev: false,
            };
        }

        // Obter configuração de ordenação
        const sortConfig = this.getSortConfig(sortOption, sortBy, sortOrder);

        // Buscar livros comprados
        const [books, total] = await Promise.all([
            this.prisma.book.findMany({
                where: { id: { in: bookIds } },
                include: { categoryRef: true },
                skip,
                take: limit,
                orderBy: { [sortConfig.field]: sortConfig.order },
            }),
            this.prisma.book.count({ where: { id: { in: bookIds } } }),
        ]);

        // Buscar favoritos e carrinho em lote
        const [favoritesCounts, cartCounts, userFavorites, userCart] = await Promise.all([
            this.prisma.favorite.groupBy({
                by: ['bookId'],
                where: { bookId: { in: bookIds } },
                _count: { bookId: true },
            }),
            this.prisma.cart.groupBy({
                by: ['bookId'],
                where: { bookId: { in: bookIds } },
                _count: { bookId: true },
            }),
            this.prisma.favorite.findMany({ where: { userId, bookId: { in: bookIds } } }),
            this.prisma.cart.findMany({ where: { userId, bookId: { in: bookIds } } }),
        ]);
        const favCountMap = Object.fromEntries(favoritesCounts.map(f => [f.bookId, f._count.bookId]));
        const cartCountMap = Object.fromEntries(cartCounts.map(c => [c.bookId, c._count.bookId]));
        const userFavSet = new Set(userFavorites.map(f => f.bookId));
        const userCartMap = Object.fromEntries(userCart.map(c => [c.bookId, c.quantity]));

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
            reviewCount: book.reviewCount,
            categoryId: book.categoryId,
            categoryName: book.category,
            cover: book.cover,
            description: book.description,
            sales: book.sales,
            createdAt: book.createdAt,
            updatedAt: book.updatedAt,
            favoritesCount: favCountMap[book.id] || 0,
            cartCount: cartCountMap[book.id] || 0,
            isFavorite: userFavSet.has(book.id),
            cartQuantity: userCartMap[book.id] || 0,
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

    private async invalidateCache(cacheKey: string) {
        await this.redisService.del(cacheKey);
    }

    async updateFreeStatus() {
        // Atualizar livros com preço 0 para isFree = true
        const freeBooks = await this.prisma.book.updateMany({
            where: { price: 0 },
            data: { isFree: true }
        });

        // Atualizar livros com preço > 0 para isFree = false
        const paidBooks = await this.prisma.book.updateMany({
            where: { price: { gt: 0 } },
            data: { isFree: false }
        });

        // Invalidar cache
        await this.invalidateCache('all_books');

        return {
            message: 'Status isFree atualizado com sucesso',
            freeBooksUpdated: freeBooks.count,
            paidBooksUpdated: paidBooks.count,
            totalUpdated: freeBooks.count + paidBooks.count
        };
    }

    async activateAllBooks() {
        // Ativar todos os livros inativos
        const result = await this.prisma.book.updateMany({
            where: { isActive: false },
            data: { isActive: true }
        });

        // Invalidar cache
        await this.invalidateCache('all_books');

        return {
            message: 'Todos os livros foram ativados com sucesso',
            booksActivated: result.count
        };
    }

    async getAllBooksDebug() {
        const books = await this.prisma.book.findMany({
            include: {
                categoryRef: true,
            },
            orderBy: { createdAt: 'desc' }
        });

        return {
            total: books.length,
            books: books.map(book => ({
                id: book.id,
                title: book.title,
                author: book.author,
                price: book.price,
                isFree: book.isFree,
                isActive: book.isActive,
                categoryId: book.categoryId,
                categoryName: book.category,
                createdAt: book.createdAt
            }))
        };
    }

    async getAllBooksWithoutFilters() {
        const books = await this.prisma.book.findMany({
            include: {
                categoryRef: true,
            },
            orderBy: { createdAt: 'desc' }
        });

        return {
            data: books.map(book => ({
                id: book.id,
                title: book.title,
                author: book.author,
                price: book.price,
                originalPrice: book.originalPrice,
                rating: book.rating,
                reviewCount: book.reviewCount,
                categoryId: book.categoryId,
                categoryName: book.category,
                cover: book.cover,
                description: book.description,
                sales: book.sales,
                isActive: book.isActive,
                isFree: book.isFree,
                createdAt: book.createdAt,
                updatedAt: book.updatedAt,
                favoritesCount: 0,
                cartCount: 0,
                isFavorite: undefined,
                cartQuantity: undefined,
            })),
            total: books.length,
            page: 1,
            limit: books.length,
            totalPages: 1,
            hasNext: false,
            hasPrev: false,
        };
    }
} 