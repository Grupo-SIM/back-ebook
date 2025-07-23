import { ApiProperty } from '@nestjs/swagger';
import { IsUUID, IsEmail, IsString, IsOptional } from 'class-validator';

export class CreateAdminDto {
  @ApiProperty({ example: 'user-uuid' })
  userId: string;
}

export class UpdateAdminDto {
  @ApiProperty({ example: 'John Doe', required: false })
  name?: string;

  @ApiProperty({ example: 'john@example.com', required: false })
  email?: string;
}

export class AdminResponseDto {
  @ApiProperty({ example: 'admin-uuid' })
  id: string;

  @ApiProperty({ example: 'John Doe' })
  name: string;

  @ApiProperty({ example: 'john@example.com' })
  email: string;

  @ApiProperty({ example: 'user-uuid' })
  userId: string;

  @ApiProperty({ example: 'ADMIN' })
  role: string;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  createdAt: string;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  updatedAt: string;
}

export class AdminRevenueDto {
  @ApiProperty({ example: 'admin-uuid' })
  adminId: string;

  @ApiProperty({ example: 'John Doe' })
  adminName: string;

  @ApiProperty({ example: 15000.50, description: 'Receita total em reais' })
  totalRevenue: number;

  @ApiProperty({ example: 150, description: 'Total de vendas realizadas' })
  totalSales: number;

  @ApiProperty({ example: 25, description: 'Total de livros vendidos' })
  totalBooksSold: number;

  @ApiProperty({ example: 5000.25, description: 'Receita do mês atual' })
  currentMonthRevenue: number;

  @ApiProperty({ example: 50, description: 'Vendas do mês atual' })
  currentMonthSales: number;

  @ApiProperty({ example: 8, description: 'Livros vendidos no mês atual' })
  currentMonthBooksSold: number;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  lastSaleDate: string;

  @ApiProperty({ example: 'O Senhor dos Anéis', description: 'Livro mais vendido' })
  bestSellingBook: string;

  @ApiProperty({ example: 500, description: 'Quantidade vendida do livro mais vendido' })
  bestSellingBookQuantity: number;

  @ApiProperty({ example: 49.90, description: 'Preço do livro mais vendido' })
  bestSellingBookPrice: number;
}

export class AdminRevenuePeriodDto {
  @ApiProperty({ example: '2024-01', description: 'Período no formato YYYY-MM' })
  period: string;

  @ApiProperty({ example: 5000.25, description: 'Receita do período' })
  revenue: number;

  @ApiProperty({ example: 50, description: 'Vendas do período' })
  sales: number;

  @ApiProperty({ example: 8, description: 'Livros vendidos no período' })
  booksSold: number;
}

export class AdminRevenueDetailedDto extends AdminRevenueDto {
  @ApiProperty({ type: [AdminRevenuePeriodDto], description: 'Receita por período (últimos 12 meses)' })
  monthlyRevenue: AdminRevenuePeriodDto[];

  @ApiProperty({ example: 100.50, description: 'Receita média por venda' })
  averageRevenuePerSale: number;

  @ApiProperty({ example: 33.50, description: 'Receita média por livro' })
  averageRevenuePerBook: number;
}
