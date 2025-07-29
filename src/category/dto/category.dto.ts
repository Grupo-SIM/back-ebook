import { IsString, IsOptional, IsBoolean, IsInt, IsNotEmpty } from 'class-validator';
import { Transform } from 'class-transformer';

export interface CategoryColor {
    name: string;
    color?: string;
}

export const categoryColors: Record<string, CategoryColor> = {
    'Programação': {
        name: 'Programação',
        color: '#2563eb',
    },
    'Finanças': {
        name: 'Finanças',
        color: '#059669',
    },
    'Autoajuda': {
        name: 'Autoajuda',
        color: '#dc2626',
    },
    'História': {
        name: 'História',
        color: '#7c3aed',
    },
    'Negócios': {
        name: 'Negócios',
        color: '#ea580c',
    },
    'Psicologia': {
        name: 'Psicologia',
        color: '#be185d',
    },
    'Ciência': {
        name: 'Ciência',
        color: '#0891b2',
    },
    'Romance': {
        name: 'Romance',
        color: '#ec4899',
    },
    'Ficção': {
        name: 'Ficção',
        color: '#8b5cf6',
    },
    'Biografia': {
        name: 'Biografia',
        color: '#f59e0b',
    },
    'Educação': {
        name: 'Educação',
        color: '#10b981',
    },
    'Arte': {
        name: 'Arte',
        color: '#ef4444',
    },
    'Tecnologia': {
        name: 'Tecnologia',
        color: '#3b82f6',
    },
    'Saúde': {
        name: 'Saúde',
        color: '#06b6d4',
    },
    'Esportes': {
        name: 'Esportes',
        color: '#84cc16',
    },
    'Viagem': {
        name: 'Viagem',
        color: '#f97316',
    },
    'Culinária': {
        name: 'Culinária',
        color: '#fbbf24',
    },
    'Filosofia': {
        name: 'Filosofia',
        color: '#6b7280',
    },
    'Religião': {
        name: 'Religião',
        color: '#8b5cf6',
    },
    'Política': {
        name: 'Política',
        color: '#dc2626',
    },
    'Economia': {
        name: 'Economia',
        color: '#059669',
    },
    'Literatura': {
        name: 'Literatura',
        color: '#7c2d12',
    },
    'Poesia': {
        name: 'Poesia',
        color: '#be185d',
    },
    'Drama': {
        name: 'Drama',
        color: '#1f2937',
    },
    'Comédia': {
        name: 'Comédia',
        color: '#fbbf24',
    },
    'Terror': {
        name: 'Terror',
        color: '#dc2626',
    },
    'Mistério': {
        name: 'Mistério',
        color: '#1f2937',
    },
    'Aventura': {
        name: 'Aventura',
        color: '#059669',
    },
    'Ficção Científica': {
        name: 'Ficção Científica',
        color: '#0891b2',
    },
    'Fantasia': {
        name: 'Fantasia',
        color: '#8b5cf6',
    },
    'Infantil': {
        name: 'Infantil',
        color: '#ec4899',
    },
    'Juvenil': {
        name: 'Juvenil',
        color: '#3b82f6',
    },
    'Acadêmico': {
        name: 'Acadêmico',
        color: '#6b7280',
    },
    'Profissional': {
        name: 'Profissional',
        color: '#ea580c',
    },
    'Hobby': {
        name: 'Hobby',
        color: '#10b981',
    },
    'Lifestyle': {
        name: 'Lifestyle',
        color: '#f59e0b',
    }
};

export class CreateCategoryDto {
    @IsString()
    @IsNotEmpty()
    name: string;

    @IsString()
    @IsOptional()
    description?: string;

    @IsString()
    @IsOptional()
    color?: string;

    @IsString()
    @IsOptional()
    icon?: string;

    @IsBoolean()
    @IsOptional()
    @Transform(({ value }) => value === 'true' || value === true)
    isActive?: boolean;
}

export class UpdateCategoryDto {
    @IsString()
    @IsOptional()
    name?: string;

    @IsString()
    @IsOptional()
    description?: string;

    @IsString()
    @IsOptional()
    color?: string;

    @IsString()
    @IsOptional()
    icon?: string;

    @IsBoolean()
    @IsOptional()
    @Transform(({ value }) => value === 'true' || value === true)
    isActive?: boolean;
}

export class CategoryResponseDto {
    id: number;
    name: string;
    description?: string;
    color?: string;
    icon?: string;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
    booksCount?: number;
}

export class CategoryQueryDto {
    @IsOptional()
    @Transform(({ value }) => value === 'true' || value === true)
    isActive?: boolean;

    @IsString()
    @IsOptional()
    search?: string;
} 
