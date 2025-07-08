import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { RedisService } from 'src/redis.service';
import {
    AddFavoriteDto,
    RemoveFavoriteDto,
    FavoriteQueryDto,
    FavoriteItemDto,
    FavoritesResponseDto,
    FavoriteStatusDto,
    FavoriteSortBy
} from './dto/favorite.dto';

@Injectable()
export class FavoriteService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly redisService: RedisService,
    ) { }

    async addFavorite(userId: string, data: AddFavoriteDto): Promise<FavoriteItemDto> {
        // Verificar se o livro existe
        const book = await this.prisma.book.findUnique({
            where: { id: data.bookId },
            include: {
                categoryRef: true,
            },
        });

        if (!book) {
            throw new NotFoundException('Livro não encontrado');
        }

        // Verificar se já é favorito
        const existingFavorite = await this.prisma.favorite.findUnique({
            where: {
                userId_bookId: {
                    userId,
                    bookId: data.bookId,
                },
            },
        });

        if (existingFavorite) {
            throw new ConflictException('Livro já está nos favoritos');
        }

        const favorite = await this.prisma.favorite.create({
            data: {
                userId,
                bookId: data.bookId,
            },
            include: {
                book: {
                    include: {
                        categoryRef: true,
                    },
                },
            },
        });

        await this.invalidateUserFavoritesCache(userId);

        return {
            id: favorite.id,
            bookId: favorite.bookId,
            bookTitle: favorite.book.title,
            bookAuthor: favorite.book.author,
            bookPrice: favorite.book.price,
            bookOriginalPrice: favorite.book.originalPrice,
            bookRating: favorite.book.rating,
            bookReviews: favorite.book.reviews,
            bookCategoryId: favorite.book.categoryId,
            bookCategoryName: favorite.book.category,
            bookCover: favorite.book.cover,
            bookDescription: favorite.book.description,
            bookSales: favorite.book.sales,
            bookCreatedAt: favorite.book.createdAt,
            bookUpdatedAt: favorite.book.updatedAt,
            addedAt: favorite.addedAt,
        };
    }

    async removeFavorite(userId: string, data: RemoveFavoriteDto): Promise<void> {
        const favorite = await this.prisma.favorite.findUnique({
            where: {
                userId_bookId: {
                    userId,
                    bookId: data.bookId,
                },
            },
        });

        if (!favorite) {
            throw new NotFoundException('Favorito não encontrado');
        }

        await this.prisma.favorite.delete({
            where: {
                userId_bookId: {
                    userId,
                    bookId: data.bookId,
                },
            },
        });

        await this.invalidateUserFavoritesCache(userId);
    }

    async getFavorites(userId: string, query: FavoriteQueryDto): Promise<FavoritesResponseDto> {
        const {
            page = 1,
            limit = 10,
            sortBy = 'recent',
            filterCategory
        } = query;

        const skip = (page - 1) * limit;

        // Construir condições de filtro
        const where: any = {
            userId,
        };

        if (filterCategory) {
            where.book = {
                category: {
                    contains: filterCategory,
                    mode: 'insensitive',
                },
            };
        }

        // Configurar ordenação
        const orderBy = this.getFavoriteSortConfig(sortBy);

        const [favorites, total] = await Promise.all([
            this.prisma.favorite.findMany({
                where,
                include: {
                    book: {
                        include: {
                            categoryRef: true,
                        },
                    },
                },
                skip,
                take: limit,
                orderBy,
            }),
            this.prisma.favorite.count({ where }),
        ]);

        const totalPages = Math.ceil(total / limit);
        const hasNext = page < totalPages;
        const hasPrev = page > 1;

        const items: FavoriteItemDto[] = favorites.map(favorite => ({
            id: favorite.id,
            bookId: favorite.bookId,
            bookTitle: favorite.book.title,
            bookAuthor: favorite.book.author,
            bookPrice: favorite.book.price,
            bookOriginalPrice: favorite.book.originalPrice,
            bookRating: favorite.book.rating,
            bookReviews: favorite.book.reviews,
            bookCategoryId: favorite.book.categoryId,
            bookCategoryName: favorite.book.category,
            bookCover: favorite.book.cover,
            bookDescription: favorite.book.description,
            bookSales: favorite.book.sales,
            bookCreatedAt: favorite.book.createdAt,
            bookUpdatedAt: favorite.book.updatedAt,
            addedAt: favorite.addedAt,
        }));

        return {
            items,
            count: items.length,
            page,
            limit,
            total,
            totalPages,
            hasNext,
            hasPrev,
        };
    }

    async getFavoriteStatus(userId: string, bookId: number): Promise<FavoriteStatusDto> {
        const favorite = await this.prisma.favorite.findUnique({
            where: {
                userId_bookId: {
                    userId,
                    bookId,
                },
            },
        });

        return {
            isFavorite: !!favorite,
            addedAt: favorite?.addedAt,
        };
    }

    async getFavoritesCount(userId: string): Promise<{ count: number }> {
        const count = await this.prisma.favorite.count({
            where: { userId },
        });

        return { count };
    }

    async clearFavorites(userId: string): Promise<void> {
        await this.prisma.favorite.deleteMany({
            where: { userId },
        });

        await this.invalidateUserFavoritesCache(userId);
    }

    private getFavoriteSortConfig(sortBy: FavoriteSortBy) {
        switch (sortBy) {
            case 'recent':
                return { addedAt: 'desc' as const };
            case 'alphabetical':
                return { book: { title: 'asc' as const } };
            case 'price-low':
                return { book: { price: 'asc' as const } };
            case 'price-high':
                return { book: { price: 'desc' as const } };
            case 'rating':
                return { book: { rating: 'desc' as const } };
            default:
                return { addedAt: 'desc' as const };
        }
    }

    private async invalidateUserFavoritesCache(userId: string) {
        await this.redisService.del(`user_favorites:${userId}`);
        await this.redisService.del(`user_favorites_count:${userId}`);
    }
} 