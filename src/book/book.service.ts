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
            createdById: query.createdById,
        };
    }

    async createBook(data: CreateBookDto, createdById: string): Promise<BookResponseDto> {
        // Verificar se a categoria existe
        const category = await this.prisma.category.findUnique({
            where: { id: data.categoryId }
        });

        if (!category) {
            throw new NotFoundException('Categoria não encontrada');
        }

        // Determinar se o livro é gratuito baseado no preço
        const isFree = data.price === 0;

        // Se cover for enviado, buscar ou criar imagem e associar coverImageId
        let coverImageId: string | undefined = undefined;
        if (data.cover) {
            let image = await this.prisma.image.findFirst({ where: { url: data.cover } });
            if (!image) {
                image = await this.prisma.image.create({ data: { url: data.cover } });
            }
            coverImageId = image.id;
        }

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
                createdById: createdById,
                // Novos campos
                language: data.language,
                publisher: data.publisher,
                publishedDate: data.publishedDate,
                printLength: data.printLength,
                downloadUrl: data.downloadUrl,
                readingAge: data.readingAge,
                isActive: data.isActive ?? true,
                ...(coverImageId ? { coverImageId } : {}),
            },
            include: {
                categoryRef: true,
            },
        });
        // Log de criação
        await this.prisma['activityLog'].create({
            data: {
                adminId: createdById,
                type: 'book_created',
                message: `Novo livro "${book.title}" foi criado`,
                bookId: book.id,
                bookTitle: book.title,
            }
        });
        await this.invalidateCache('all_books');

        return {
            id: book.id,
            title: book.title,
            author: book.author,
            price: book.price,
            originalPrice: (book.originalPrice && book.originalPrice > 0) ? book.originalPrice : undefined,
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
            // Novos campos
            language: book.language ?? undefined,
            publisher: book.publisher ?? undefined,
            publishedDate: book.publishedDate ?? undefined,
            printLength: book.printLength ?? undefined,
            downloadUrl: book.downloadUrl ?? undefined,
            isFree: book.isFree ?? false,
            readingAge: book.readingAge ?? undefined,
            isActive: book.isActive ?? true,
            checkoutUrl: `https://checkout.jbmidia.com/?value=${book.price}&description=${encodeURIComponent(book.title)}&store=ebook`,
        };
    }

    async getAllBooks(query: BookQueryDto, userId?: string, onlyAdminBooks?: boolean): Promise<PaginatedBookResponseDto> {
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
            type,
            createdById
        } = { ...convertedQuery, type: query.type, createdById: query.createdById };

        const skip = (page - 1) * limit;

        // Construir condições de filtro
        const where: any = {};
        if (!onlyAdminBooks) {
            where.isActive = true; // Mostrar apenas livros ativos para público
        }

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

        if (onlyAdminBooks && createdById) {
            where.createdById = createdById;
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
            originalPrice: (book.originalPrice && book.originalPrice > 0) ? book.originalPrice : undefined,
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
            // Novos campos
            language: book.language ?? undefined,
            publisher: book.publisher ?? undefined,
            publishedDate: book.publishedDate ?? undefined,
            printLength: book.printLength ?? undefined,
            downloadUrl: book.downloadUrl ?? undefined,
            isFree: book.isFree ?? false,
            readingAge: book.readingAge ?? undefined,
            isActive: book.isActive ?? true,
            checkoutUrl: `https://checkout.jbmidia.com/?value=${book.price}&description=${encodeURIComponent(book.title)}&store=ebook`,
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

    async getBookById(id: number, userId?: string, onlyAdminBooks?: boolean): Promise<BookResponseDto> {
        const cacheKey = `book:${id}`;
        const cached = await this.redisService.get(cacheKey);

        const book = await this.prisma.book.findUnique({
            where: { 
                id,
                ...(onlyAdminBooks ? {} : { isActive: true }) // Se não for admin, só mostrar livros ativos
            },
            include: {
                categoryRef: true,
            },
        });

        if (!book) {
            throw new NotFoundException('Book not found');
        }

        if (onlyAdminBooks && userId && book.createdById !== userId) {
            throw new NotFoundException('Book not found for this admin');
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
            originalPrice: (book.originalPrice && book.originalPrice > 0) ? book.originalPrice : undefined,
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
            // Novos campos
            language: book.language ?? undefined,
            publisher: book.publisher ?? undefined,
            publishedDate: book.publishedDate ?? undefined,
            printLength: book.printLength ?? undefined,
            downloadUrl: book.downloadUrl ?? undefined,
            isFree: book.isFree ?? false,
            readingAge: book.readingAge ?? undefined,
            isActive: book.isActive ?? true,
            checkoutUrl: `https://checkout.jbmidia.com/?value=${book.price}&description=${encodeURIComponent(book.title)}&store=ebook`,
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
        const where: any = { 
            categoryId: categoryId,
            isActive: true // Mostrar apenas livros ativos
        };

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
            originalPrice: (book.originalPrice && book.originalPrice > 0) ? book.originalPrice : undefined,
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
            // Novos campos
            language: book.language ?? undefined,
            publisher: book.publisher ?? undefined,
            publishedDate: book.publishedDate ?? undefined,
            printLength: book.printLength ?? undefined,
            downloadUrl: book.downloadUrl ?? undefined,
            isFree: book.isFree ?? false,
            readingAge: book.readingAge ?? undefined,
            isActive: book.isActive ?? true,
            checkoutUrl: `https://checkout.jbmidia.com/?value=${book.price}&description=${encodeURIComponent(book.title)}&store=ebook`,
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
            isActive: true, // Mostrar apenas livros ativos
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
            originalPrice: (book.originalPrice && book.originalPrice > 0) ? book.originalPrice : undefined,
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
            // Novos campos
            language: book.language ?? undefined,
            publisher: book.publisher ?? undefined,
            publishedDate: book.publishedDate ?? undefined,
            printLength: book.printLength ?? undefined,
            downloadUrl: book.downloadUrl ?? undefined,
            isFree: book.isFree ?? false,
            readingAge: book.readingAge ?? undefined,
            isActive: book.isActive ?? true,
            checkoutUrl: `https://checkout.jbmidia.com/?value=${book.price}&description=${encodeURIComponent(book.title)}&store=ebook`,
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

    async updateBook(id: number, data: UpdateBookDto, adminId?: string, onlyAdminBooks?: boolean): Promise<BookResponseDto> {
        const existingBook = await this.prisma.book.findUnique({
            where: { id },
            include: { createdBy: true },
        });
        if (!existingBook) {
            throw new NotFoundException('Book not found');
        }
        if (onlyAdminBooks && adminId && existingBook.createdById !== adminId) {
            throw new NotFoundException('Book not found for this admin');
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
        // Novos campos
        if (data.language !== undefined) updateData.language = data.language;
        if (data.publisher !== undefined) updateData.publisher = data.publisher;
        if (data.publishedDate !== undefined) updateData.publishedDate = data.publishedDate;
        if (data.printLength !== undefined) updateData.printLength = data.printLength;
        if (data.downloadUrl !== undefined) updateData.downloadUrl = data.downloadUrl;
        if (data.readingAge !== undefined) updateData.readingAge = data.readingAge;
        if (data.isActive !== undefined) updateData.isActive = data.isActive;

        // Se cover for enviado, buscar ou criar imagem e associar coverImageId
        if (data.cover) {
            let image = await this.prisma.image.findFirst({ where: { url: data.cover } });
            if (!image) {
                image = await this.prisma.image.create({ data: { url: data.cover } });
            }
            updateData.coverImageId = image.id;
        }

        const updatedBook = await this.prisma.book.update({
            where: { id },
            data: updateData,
            include: {
                categoryRef: true,
            },
        });

        // Log de atualização
        if (existingBook.createdBy?.id) {
            await this.prisma['activityLog'].create({
                data: {
                    adminId: existingBook.createdBy.id,
                    type: 'book_updated',
                    message: `Livro "${existingBook.title}" foi atualizado`,
                    bookId: existingBook.id,
                    bookTitle: existingBook.title,
                }
            });
        }

        await this.invalidateCache(`book:${id}`);
        await this.invalidateCache('all_books');

        return {
            id: updatedBook.id,
            title: updatedBook.title,
            author: updatedBook.author,
            price: updatedBook.price,
            originalPrice: (updatedBook.originalPrice && updatedBook.originalPrice > 0) ? updatedBook.originalPrice : undefined,
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
            // Novos campos
            language: updatedBook.language ?? undefined,
            publisher: updatedBook.publisher ?? undefined,
            publishedDate: updatedBook.publishedDate ?? undefined,
            printLength: updatedBook.printLength ?? undefined,
            downloadUrl: updatedBook.downloadUrl ?? undefined,
            isFree: updatedBook.isFree ?? false,
            readingAge: updatedBook.readingAge ?? undefined,
            isActive: updatedBook.isActive ?? true,
            checkoutUrl: `https://checkout.jbmidia.com/?value=${updatedBook.price}&description=${encodeURIComponent(updatedBook.title)}`,
        };
    }

    async deleteBook(id: number, adminId?: string, onlyAdminBooks?: boolean): Promise<BookResponseDto> {
        const book = await this.prisma.book.findUnique({ where: { id }, include: { createdBy: true } });
        if (!book) {
            throw new NotFoundException('Book not found');
        }
        if (onlyAdminBooks && adminId && book.createdById !== adminId) {
            throw new NotFoundException('Book not found for this admin');
        }
        // Registrar log de deleção
        if (book.createdBy?.id) {
            await this.prisma['activityLog'].create({
                data: {
                    adminId: book.createdBy.id,
                    type: 'book_deleted',
                    message: `Livro "${book.title}" foi removido`,
                    bookId: book.id,
                    bookTitle: book.title,
                }
            });
        }
        const deleted = await this.prisma.book.delete({ where: { id } });
        await this.invalidateCache('all_books');
        return {
            id: deleted.id,
            title: deleted.title,
            author: deleted.author,
            price: deleted.price,
            originalPrice: (deleted.originalPrice && deleted.originalPrice > 0) ? deleted.originalPrice : undefined,
            rating: deleted.rating,
            reviewCount: deleted.reviewCount,
            categoryId: deleted.categoryId,
            categoryName: deleted.category,
            cover: deleted.cover,
            description: deleted.description,
            sales: deleted.sales,
            createdAt: deleted.createdAt,
            updatedAt: deleted.updatedAt,
            favoritesCount: 0,
            cartCount: 0,
            isFree: deleted.isFree ?? false,
            readingAge: deleted.readingAge ?? undefined,
            isActive: deleted.isActive ?? true,
            checkoutUrl: `https://checkout.jbmidia.com/?value=${deleted.price}&description=${encodeURIComponent(deleted.title)}`,
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
            isActive: true, // Mostrar apenas livros ativos
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
            originalPrice: (book.originalPrice && book.originalPrice > 0) ? book.originalPrice : undefined,
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
            isFree: book.isFree ?? false,
            readingAge: book.readingAge ?? undefined,
            isActive: book.isActive ?? true,
            checkoutUrl: `https://checkout.jbmidia.com/?value=${book.price}&description=${encodeURIComponent(book.title)}&store=ebook`,
        }));
        const totalPages = Math.ceil(total / limit);
        const hasNext = page < totalPages;
        const hasPrev = page > 1;
        return { data, page, limit, total, totalPages, hasNext, hasPrev };
    }

    async getTopSellingBooks(limit: number = 10): Promise<BookResponseDto[]> {
        const books = await this.prisma.book.findMany({
            where: { isActive: true }, // Mostrar apenas livros ativos
            orderBy: { sales: 'desc' },
            take: limit,
            include: { categoryRef: true },
        });
        return books.map(book => ({
            id: book.id,
            title: book.title,
            author: book.author,
            price: book.price,
            originalPrice: (book.originalPrice && book.originalPrice > 0) ? book.originalPrice : undefined,
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
            // Novos campos
            language: book.language ?? undefined,
            publisher: book.publisher ?? undefined,
            publishedDate: book.publishedDate ?? undefined,
            printLength: book.printLength ?? undefined,
            isFree: book.isFree ?? false,
            readingAge: book.readingAge ?? undefined,
            isActive: book.isActive ?? true,
            checkoutUrl: `https://checkout.jbmidia.com/?value=${book.price}&description=${encodeURIComponent(book.title)}&store=ebook`,
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

        // Buscar dados do usuário e do livro
        const [user, book] = await Promise.all([
            this.prisma.user.findUnique({ where: { id: userId }, include: { Image: true } }),
            this.prisma.book.findUnique({ where: { id: bookId } })
        ]);

        // ✅ CORREÇÃO: Log de review corrigido
        if (book && book.createdById) {
            await this.prisma['activityLog'].create({
                data: {
                    adminId: book.createdById,
                    type: 'review',
                    message: `Nova avaliação ${review.rating || 'sem nota'} ${review.rating ? 'estrelas' : ''} para "${book.title}" por ${user?.name || 'usuário'}`,
                    bookId: book.id,
                    bookTitle: book.title,
                }
            });
        }

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
                include: { user: { include: { avatarImage: true } } },
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
                userAvatar: r.user?.avatarImage?.url,
            })),
            page,
            limit,
            total,
            totalPages,
        };
    }

    async getPurchasedBooks(query: BookQueryDto, userId: string): Promise<PaginatedBookResponseDto> {
        // ✅ NOVO: Detectar e logar novas compras antes de retornar a lista
        await this.detectAndLogNewPurchases();

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
                where: { 
                    id: { in: bookIds },
                    isActive: true // Mostrar apenas livros ativos
                },
                include: { categoryRef: true },
                skip,
                take: limit,
                orderBy: { [sortConfig.field]: sortConfig.order },
            }),
            this.prisma.book.count({ where: { 
                id: { in: bookIds },
                isActive: true // Mostrar apenas livros ativos
            } }),
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
            originalPrice: (book.originalPrice && book.originalPrice > 0) ? book.originalPrice : undefined,
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
            // Novos campos
            language: book.language ?? undefined,
            publisher: book.publisher ?? undefined,
            publishedDate: book.publishedDate ?? undefined,
            printLength: book.printLength ?? undefined,
            downloadUrl: book.downloadUrl ?? undefined,
            isFree: book.isFree ?? false,
            readingAge: book.readingAge ?? undefined,
            isActive: book.isActive ?? true,
            checkoutUrl: `https://checkout.jbmidia.com/?value=${book.price}&description=${encodeURIComponent(book.title)}&store=ebook`,
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

    async userHasPurchasedBook(bookId: number, userId: string): Promise<boolean> {
        const orderItem = await this.prisma.orderItem.findFirst({
            where: {
                bookId,
                order: {
                    userId,
                    status: 'paid',
                },
            },
        });
        return !!orderItem;
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
                originalPrice: (book.originalPrice && book.originalPrice > 0) ? book.originalPrice : undefined,
                isFree: book.isFree,
                isActive: book.isActive,
                categoryId: book.categoryId,
                categoryName: book.category,
                createdAt: book.createdAt,
                // Novos campos
                language: book.language ?? undefined,
                publisher: book.publisher ?? undefined,
                publishedDate: book.publishedDate ?? undefined,
                printLength: book.printLength ?? undefined,
                readingAge: book.readingAge ?? undefined,
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
                originalPrice: (book.originalPrice && book.originalPrice > 0) ? book.originalPrice : undefined,
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
                // Novos campos
                language: book.language ?? undefined,
                publisher: book.publisher ?? undefined,
                publishedDate: book.publishedDate ?? undefined,
                printLength: book.printLength ?? undefined,
                readingAge: book.readingAge ?? undefined,
                checkoutUrl: `https://checkout.jbmidia.com/?value=${book.price}&description=${encodeURIComponent(book.title)}&store=ebook`,
            })),
            total: books.length,
            page: 1,
            limit: books.length,
            totalPages: 1,
            hasNext: false,
            hasPrev: false,
        };
    }

    async detectAndLogNewPurchases(): Promise<void> {
        try {
            console.log('🔍 Iniciando detecção de novas compras...');

            // Buscar compras recentes (últimas 24 horas) que ainda não foram logadas
            const recentPurchases = await this.prisma.orderItem.findMany({
                where: {
                    order: {
                        status: 'paid',
                        updatedAt: {
                            gte: new Date(Date.now() - 24 * 60 * 60 * 1000) // últimas 24 horas
                        }
                    }
                },
                include: {
                    book: true,
                    order: {
                        include: {
                            user: true
                        }
                    }
                }
            });

            console.log(`📦 Encontradas ${recentPurchases.length} compras recentes`);

            for (const purchase of recentPurchases) {
                const { book, order } = purchase;

                console.log(`📚 Processando: Livro "${book?.title}" - Pedido #${order.id} - Status: ${order.status}`);
                console.log(`👤 Usuário: ${order.user?.name} - Admin criador: ${book?.createdById}`);

                if (book && book.createdById && order.user) {
                    // Verificar se já existe um log para esta compra específica
                    const existingLog = await this.prisma['activityLog'].findFirst({
                        where: {
                            type: 'sale',
                            bookId: book.id,
                            message: {
                                contains: `Pedido #${order.id}`
                            }
                        }
                    });

                    console.log(`📋 Log existente para pedido #${order.id}:`, !!existingLog);

                    // Se não existe log para esta compra, criar
                    if (!existingLog) {
                        const logData = {
                            adminId: book.createdById,
                            type: 'sale',
                            message: `Venda realizada: "${book.title}" comprado por ${order.user.name || 'usuário'} - Qtd: ${purchase.quantity} - Total: R$ ${purchase.totalPrice.toFixed(2)} - Pedido #${order.id}`,
                            bookId: book.id,
                            bookTitle: book.title,
                        };

                        console.log('📝 Criando log:', logData);

                        await this.prisma['activityLog'].create({
                            data: logData
                        });

                        console.log(`✅ Log de venda criado: ${book.title} para admin ${book.createdById}`);
                    } else {
                        console.log(`⏭️ Log já existe para pedido #${order.id}`);
                    }
                } else {
                    console.log(`❌ Dados insuficientes - Book: ${!!book}, CreatedById: ${book?.createdById}, User: ${!!order.user}`);
                }
            }

            console.log('🏁 Detecção de novas compras finalizada');
        } catch (error) {
            console.error('❌ Erro ao detectar e logar novas compras:', error);
        }
    }

    async getReviewStats(bookId: number) {
        // Buscar todos os reviews do livro
        const reviews = await this.prisma.review.findMany({
            where: { bookId },
            select: { rating: true }
        });
        // Inicializar contadores
        const stats = {
            quantity1: 0,
            quantity2: 0,
            quantity3: 0,
            quantity4: 0,
            quantity5: 0,
            average: 0
        };
        if (reviews.length === 0) return stats;
        let sum = 0;
        for (const r of reviews) {
            sum += r.rating;
            if (r.rating === 1) stats.quantity1++;
            if (r.rating === 2) stats.quantity2++;
            if (r.rating === 3) stats.quantity3++;
            if (r.rating === 4) stats.quantity4++;
            if (r.rating === 5) stats.quantity5++;
        }
        stats.average = Math.round((sum / reviews.length) * 10) / 10;
        return stats;
    }
} 
