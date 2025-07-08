import { IsString, IsOptional, IsBoolean, IsInt, IsNotEmpty } from 'class-validator';
import { Transform } from 'class-transformer';

export interface CategoryColor {
    name: string;
    color?: string;
    icon?: string;
}

export const categoryColors: Record<string, CategoryColor> = {
    'Programação': {
        name: 'Programação',
        color: '#2563eb',
        icon: '💻'
    },
    'Finanças': {
        name: 'Finanças',
        color: '#059669',
        icon: '💰'
    },
    'Autoajuda': {
        name: 'Autoajuda',
        color: '#dc2626',
        icon: '💪'
    },
    'História': {
        name: 'História',
        color: '#7c3aed',
        icon: '📚'
    },
    'Negócios': {
        name: 'Negócios',
        color: '#ea580c',
        icon: '🏢'
    },
    'Psicologia': {
        name: 'Psicologia',
        color: '#be185d',
        icon: '🧠'
    },
    'Ciência': {
        name: 'Ciência',
        color: '#0891b2',
        icon: '🔬'
    },
    'Romance': {
        name: 'Romance',
        color: '#ec4899',
        icon: '💕'
    },
    'Ficção': {
        name: 'Ficção',
        color: '#8b5cf6',
        icon: '🚀'
    },
    'Biografia': {
        name: 'Biografia',
        color: '#f59e0b',
        icon: '👤'
    },
    'Educação': {
        name: 'Educação',
        color: '#10b981',
        icon: '🎓'
    },
    'Arte': {
        name: 'Arte',
        color: '#ef4444',
        icon: '🎨'
    },
    'Tecnologia': {
        name: 'Tecnologia',
        color: '#3b82f6',
        icon: '⚡'
    },
    'Saúde': {
        name: 'Saúde',
        color: '#06b6d4',
        icon: '🏥'
    },
    'Esportes': {
        name: 'Esportes',
        color: '#84cc16',
        icon: '⚽'
    },
    'Viagem': {
        name: 'Viagem',
        color: '#f97316',
        icon: '✈️'
    },
    'Culinária': {
        name: 'Culinária',
        color: '#fbbf24',
        icon: '👨‍🍳'
    },
    'Filosofia': {
        name: 'Filosofia',
        color: '#6b7280',
        icon: '🤔'
    },
    'Religião': {
        name: 'Religião',
        color: '#8b5cf6',
        icon: '⛪'
    },
    'Política': {
        name: 'Política',
        color: '#dc2626',
        icon: '🏛️'
    },
    'Economia': {
        name: 'Economia',
        color: '#059669',
        icon: '📊'
    },
    'Literatura': {
        name: 'Literatura',
        color: '#7c2d12',
        icon: '📖'
    },
    'Poesia': {
        name: 'Poesia',
        color: '#be185d',
        icon: '✍️'
    },
    'Drama': {
        name: 'Drama',
        color: '#1f2937',
        icon: '🎭'
    },
    'Comédia': {
        name: 'Comédia',
        color: '#fbbf24',
        icon: '😄'
    },
    'Terror': {
        name: 'Terror',
        color: '#dc2626',
        icon: '👻'
    },
    'Mistério': {
        name: 'Mistério',
        color: '#1f2937',
        icon: '🔍'
    },
    'Aventura': {
        name: 'Aventura',
        color: '#059669',
        icon: '🗺️'
    },
    'Ficção Científica': {
        name: 'Ficção Científica',
        color: '#0891b2',
        icon: '🚀'
    },
    'Fantasia': {
        name: 'Fantasia',
        color: '#8b5cf6',
        icon: '🐉'
    },
    'Infantil': {
        name: 'Infantil',
        color: '#ec4899',
        icon: '🧸'
    },
    'Juvenil': {
        name: 'Juvenil',
        color: '#3b82f6',
        icon: '👦'
    },
    'Acadêmico': {
        name: 'Acadêmico',
        color: '#6b7280',
        icon: '🎓'
    },
    'Profissional': {
        name: 'Profissional',
        color: '#ea580c',
        icon: '💼'
    },
    'Hobby': {
        name: 'Hobby',
        color: '#10b981',
        icon: '🎯'
    },
    'Lifestyle': {
        name: 'Lifestyle',
        color: '#f59e0b',
        icon: '🌟'
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