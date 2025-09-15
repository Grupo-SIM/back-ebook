import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNumber, IsOptional, IsBoolean, IsEnum, IsObject, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export type CheckoutStep = 'selection' | 'payment' | 'confirmation';
export type OrderStatus = 'pending' | 'paid' | 'cancelled' | 'delivered';
export type PaymentStatus = 'pending' | 'paid' | 'failed';
export type PaymentMethod = 'credit_card' | 'pix' | 'bank_transfer' | 'paypal';

// Interfaces TypeScript puras conforme especificado
export interface CartItem {
    id: number;
    bookId: number;
    bookTitle: string;
    bookAuthor: string;
    bookPrice: number;
    bookOriginalPrice: number | null;
    bookCover: string;
    quantity: number;
    totalPrice: number;
}

export interface CheckoutItem extends CartItem {
    selected: boolean;
}

export interface CheckoutState {
    items: CheckoutItem[];
    selectedItem: CheckoutItem | null;
    step: 'selection' | 'payment' | 'confirmation';
}

export interface CartPageProps {
    initialCartItems: CartItem[];
}

// DTOs para API
export class CartItemDto implements CartItem {
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

    @ApiProperty({ example: 'https://example.com/cover.jpg' })
    bookCover: string;

    @ApiProperty({ example: 1 })
    quantity: number;

    @ApiProperty({ example: 49.90 })
    totalPrice: number;
}

export class CheckoutItemDto implements CheckoutItem {
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

    @ApiProperty({ example: 'https://example.com/cover.jpg' })
    bookCover: string;

    @ApiProperty({ example: 1 })
    quantity: number;

    @ApiProperty({ example: 49.90 })
    totalPrice: number;

    @ApiProperty({ example: true })
    selected: boolean;
}

export class AddToCartDto {
    @ApiProperty({ example: 1, description: 'ID do livro' })
    @IsNumber()
    @Type(() => Number)
    bookId: number;

    @ApiProperty({ example: 1, description: 'Quantidade', required: false })
    @IsOptional()
    @IsNumber()
    @Min(1)
    @Type(() => Number)
    quantity?: number = 1;
}

export class UpdateCartItemDto {
    @ApiProperty({ example: 1, description: 'Quantidade' })
    @IsNumber()
    @Min(1)
    @Type(() => Number)
    quantity: number;

    @ApiProperty({ example: true, description: 'Selecionado' })
    @IsBoolean()
    selected: boolean;
}

export class SelectCartItemsDto {
    @ApiProperty({ example: [1, 2, 3], description: 'IDs dos itens selecionados' })
    @IsNumber({}, { each: true })
    @Type(() => Number)
    selectedIds: number[];
}

export class AddressDto {
    @ApiProperty({ example: 'João Silva' })
    @IsString()
    name: string;

    @ApiProperty({ example: 'Rua das Flores, 123' })
    @IsString()
    street: string;

    @ApiProperty({ example: 'Apto 45' })
    @IsOptional()
    @IsString()
    complement?: string;

    @ApiProperty({ example: 'São Paulo' })
    @IsString()
    city: string;

    @ApiProperty({ example: 'SP' })
    @IsString()
    state: string;

    @ApiProperty({ example: '01234-567' })
    @IsString()
    zipCode: string;

    @ApiProperty({ example: 'Brasil' })
    @IsString()
    country: string;

    @ApiProperty({ example: '+55 11 99999-9999' })
    @IsString()
    phone: string;
}

export class OrderItemDto {
    @ApiProperty({ example: 1 })
    id: number;

    @ApiProperty({ example: 1 })
    bookId: number;

    @ApiProperty({ example: 'O Senhor dos Anéis' })
    bookTitle: string;

    @ApiProperty({ example: 'J.R.R. Tolkien' })
    bookAuthor: string;

    @ApiProperty({ example: 'https://example.com/cover.jpg' })
    bookCover: string;

    @ApiProperty({ example: 1 })
    quantity: number;

    @ApiProperty({ example: 49.90 })
    unitPrice: number;

    @ApiProperty({ example: 49.90 })
    totalPrice: number;
}

export class CreateOrderDto {
    @ApiProperty({ example: [1, 2, 3], description: 'IDs dos itens do carrinho' })
    @IsNumber({}, { each: true })
    @Type(() => Number)
    cartItemIds: number[];
}

export class CreateOrderFromBookDto {
    @ApiProperty({ example: 123, description: 'ID do livro' })
    @IsNumber()
    @Type(() => Number)
    bookId: number;

    @ApiProperty({ example: 1, required: false, description: 'Quantidade' })
    @IsOptional()
    @IsNumber()
    @Type(() => Number)
    quantity?: number = 1;
}

export class OrderResponseDto {
    @ApiProperty({ example: 1 })
    id: number;

    @ApiProperty({ example: 'ORD-2024-001' })
    orderNumber: string;

    @ApiProperty({ example: 'pending', enum: ['pending', 'paid', 'cancelled', 'delivered'] })
    status: OrderStatus;

    @ApiProperty({ example: 149.70 })
    totalAmount: number;

    @ApiProperty({ example: 149.70 })
    subtotal: number;

    @ApiProperty({ example: 10.00 })
    discount: number;

    @ApiProperty({ example: 'credit_card' })
    paymentMethod: string;

    @ApiProperty({ example: 'pending', enum: ['pending', 'paid', 'failed'] })
    paymentStatus: PaymentStatus;

    @ApiProperty({ example: 'ebook', description: 'Identifica a plataforma de origem' })
    store?: string;

    @ApiProperty({ type: AddressDto })
    shippingAddress: AddressDto;

    @ApiProperty({ type: AddressDto, nullable: true })
    billingAddress?: AddressDto;

    @ApiProperty({ example: 'Entregar após às 18h', nullable: true })
    notes?: string;

    @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
    createdAt: Date;

    @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
    updatedAt: Date;

    @ApiProperty({ type: [OrderItemDto] })
    items: OrderItemDto[];
}

export class CheckoutStateDto implements CheckoutState {
    @ApiProperty({ type: [CheckoutItemDto] })
    items: CheckoutItemDto[];

    @ApiProperty({ type: CheckoutItemDto, nullable: true })
    selectedItem: CheckoutItemDto | null;

    @ApiProperty({
        example: 'selection',
        enum: ['selection', 'payment', 'confirmation']
    })
    step: 'selection' | 'payment' | 'confirmation';
}

export class OrderQueryDto {
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

    @ApiProperty({
        example: 'pending',
        enum: ['pending', 'paid', 'cancelled', 'delivered'],
        required: false
    })
    @IsOptional()
    @IsEnum(['pending', 'paid', 'cancelled', 'delivered'])
    status?: OrderStatus;
} 