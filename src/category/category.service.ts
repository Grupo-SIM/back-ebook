import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { RedisService } from 'src/redis.service';
import { CreateCategoryDto, UpdateCategoryDto, CategoryResponseDto, CategoryQueryDto, categoryColors } from './dto/category.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class CategoryService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly redisService: RedisService,
    ) { }

    async createCategory(data: CreateCategoryDto): Promise<CategoryResponseDto> {
        // Verificar se já existe uma categoria com o mesmo nome
        const existingCategory = await this.prisma.category.findUnique({
            where: { name: data.name }
        });

        if (existingCategory) {
            throw new ConflictException('Categoria com este nome já existe');
        }

        // Se não foi fornecido cor ou ícone, usar os predefinidos
        const categoryConfig = categoryColors[data.name];
        const color = data.color || categoryConfig?.color;
        const icon = data.icon || categoryConfig?.icon;

        const category = await this.prisma.category.create({
            data: {
                name: data.name,
                description: data.description,
                color,
                icon,
                isActive: data.isActive ?? true,
            },
        });

        await this.invalidateCache('all_categories');

        return {
            id: category.id,
            name: category.name,
            description: category.description,
            color: category.color,
            icon: category.icon,
            isActive: category.isActive,
            createdAt: category.createdAt,
            updatedAt: category.updatedAt,
        };
    }

    async getAllCategories(query: CategoryQueryDto): Promise<CategoryResponseDto[]> {
        const { isActive, search } = query;

        // Construir condições de filtro
        const where: any = {};

        if (isActive !== undefined) {
            where.isActive = isActive;
        }

        if (search) {
            where.OR = [
                { name: { contains: search, mode: 'insensitive' } },
                { description: { contains: search, mode: 'insensitive' } },
            ];
        }

        const categories = await this.prisma.category.findMany({
            where,
            include: {
                _count: {
                    select: {
                        books: true,
                    },
                },
            },
            orderBy: [
                { isActive: 'desc' },
                { name: 'asc' },
            ],
        });

        return categories.map(category => ({
            id: category.id,
            name: category.name,
            description: category.description,
            color: category.color,
            icon: category.icon,
            isActive: category.isActive,
            createdAt: category.createdAt,
            updatedAt: category.updatedAt,
            booksCount: category._count.books,
        }));
    }

    async getCategoryById(id: number): Promise<CategoryResponseDto> {
        const cacheKey = `category:${id}`;
        const cached = await this.redisService.get(cacheKey);

        if (cached) {
            return JSON.parse(cached);
        }

        const category = await this.prisma.category.findUnique({
            where: { id },
            include: {
                _count: {
                    select: {
                        books: true,
                    },
                },
            },
        });

        if (!category) {
            throw new NotFoundException('Categoria não encontrada');
        }

        const response = {
            id: category.id,
            name: category.name,
            description: category.description,
            color: category.color,
            icon: category.icon,
            isActive: category.isActive,
            createdAt: category.createdAt,
            updatedAt: category.updatedAt,
            booksCount: category._count.books,
        };

        await this.redisService.set(cacheKey, JSON.stringify(response), 300); // 5 minutos

        return response;
    }

    async getCategoryByName(name: string): Promise<CategoryResponseDto> {
        const category = await this.prisma.category.findUnique({
            where: { name },
            include: {
                _count: {
                    select: {
                        books: true,
                    },
                },
            },
        });

        if (!category) {
            throw new NotFoundException('Categoria não encontrada');
        }

        return {
            id: category.id,
            name: category.name,
            description: category.description,
            color: category.color,
            icon: category.icon,
            isActive: category.isActive,
            createdAt: category.createdAt,
            updatedAt: category.updatedAt,
            booksCount: category._count.books,
        };
    }

    async updateCategory(id: number, data: UpdateCategoryDto): Promise<CategoryResponseDto> {
        const existingCategory = await this.prisma.category.findUnique({
            where: { id },
            include: {
                _count: {
                    select: {
                        books: true,
                    },
                },
            },
        });

        if (!existingCategory) {
            throw new NotFoundException('Categoria não encontrada');
        }

        // Se o nome está sendo alterado, verificar se já existe outra categoria com o mesmo nome
        if (data.name && data.name !== existingCategory.name) {
            const categoryWithSameName = await this.prisma.category.findUnique({
                where: { name: data.name }
            });

            if (categoryWithSameName) {
                throw new ConflictException('Categoria com este nome já existe');
            }
        }

        // Se não foi fornecido cor ou ícone, usar os predefinidos
        const categoryConfig = categoryColors[data.name || existingCategory.name];
        const color = data.color || categoryConfig?.color || existingCategory.color;
        const icon = data.icon || categoryConfig?.icon || existingCategory.icon;

        const updatedCategory = await this.prisma.category.update({
            where: { id },
            data: {
                name: data.name,
                description: data.description,
                color,
                icon,
                isActive: data.isActive,
            },
            include: {
                _count: {
                    select: {
                        books: true,
                    },
                },
            },
        });

        await this.invalidateCache(`category:${id}`);
        await this.invalidateCache('all_categories');

        return {
            id: updatedCategory.id,
            name: updatedCategory.name,
            description: updatedCategory.description,
            color: updatedCategory.color,
            icon: updatedCategory.icon,
            isActive: updatedCategory.isActive,
            createdAt: updatedCategory.createdAt,
            updatedAt: updatedCategory.updatedAt,
            booksCount: updatedCategory._count.books,
        };
    }

    async deleteCategory(id: number): Promise<CategoryResponseDto> {
        const category = await this.prisma.category.findUnique({
            where: { id },
            include: {
                _count: {
                    select: {
                        books: true,
                    },
                },
            },
        });

        if (!category) {
            throw new NotFoundException('Categoria não encontrada');
        }

        // Verificar se há livros associados a esta categoria
        if (category._count.books > 0) {
            throw new ConflictException('Não é possível excluir uma categoria que possui livros associados');
        }

        const deletedCategory = await this.prisma.category.delete({
            where: { id },
        });

        await this.invalidateCache(`category:${id}`);
        await this.invalidateCache('all_categories');

        return {
            id: deletedCategory.id,
            name: deletedCategory.name,
            description: deletedCategory.description,
            color: deletedCategory.color,
            icon: deletedCategory.icon,
            isActive: deletedCategory.isActive,
            createdAt: deletedCategory.createdAt,
            updatedAt: deletedCategory.updatedAt,
        };
    }

    async getActiveCategories(): Promise<CategoryResponseDto[]> {
        const cacheKey = 'active_categories';
        const cached = await this.redisService.get(cacheKey);

        if (cached) {
            return JSON.parse(cached);
        }

        const categories = await this.prisma.category.findMany({
            where: { isActive: true },
            include: {
                _count: {
                    select: {
                        books: true,
                    },
                },
            },
            orderBy: { name: 'asc' },
        });

        const response = categories.map(category => ({
            id: category.id,
            name: category.name,
            description: category.description,
            color: category.color,
            icon: category.icon,
            isActive: category.isActive,
            createdAt: category.createdAt,
            updatedAt: category.updatedAt,
            booksCount: category._count.books,
        }));

        await this.redisService.set(cacheKey, JSON.stringify(response), 300); // 5 minutos

        return response;
    }

    async getCategoriesWithMostBooks(limit: number = 10): Promise<CategoryResponseDto[]> {
        const categories = await this.prisma.category.findMany({
            where: { isActive: true },
            include: {
                _count: {
                    select: {
                        books: true,
                    },
                },
            },
            orderBy: {
                books: {
                    _count: 'desc',
                },
            },
            take: limit,
        });

        return categories.map(category => ({
            id: category.id,
            name: category.name,
            description: category.description,
            color: category.color,
            icon: category.icon,
            isActive: category.isActive,
            createdAt: category.createdAt,
            updatedAt: category.updatedAt,
            booksCount: category._count.books,
        }));
    }

    async seedDefaultCategories(): Promise<void> {
        const existingCategories = await this.prisma.category.findMany({
            select: { name: true }
        });

        const existingNames = existingCategories.map(cat => cat.name);

        for (const [name, config] of Object.entries(categoryColors)) {
            if (!existingNames.includes(name)) {
                await this.prisma.category.create({
                    data: {
                        name,
                        description: `Categoria ${name}`,
                        color: config.color,
                        icon: config.icon,
                        isActive: true,
                    },
                });
            }
        }

        await this.invalidateCache('all_categories');
        await this.invalidateCache('active_categories');
    }

    private async invalidateCache(cacheKey: string) {
        await this.redisService.del(cacheKey);
    }
} 