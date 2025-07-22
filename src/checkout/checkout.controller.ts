import {
    Controller,
    Get,
    Post,
    Put,
    Delete,
    Body,
    Param,
    Query,
    UseGuards,
    Request,
    ParseIntPipe
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuardAll } from 'src/auth/guard/jwt-auth.guard';
import { CheckoutService } from './checkout.service';
import {
    CartItemDto,
    CheckoutItemDto,
    AddToCartDto,
    UpdateCartItemDto,
    SelectCartItemsDto,
    CreateOrderDto,
    OrderResponseDto,
    CheckoutStateDto,
    OrderQueryDto,
    CartItem,
    CheckoutItem,
    CheckoutState,
    CreateOrderFromBookDto
} from './dto/checkout.dto';

@ApiTags('Checkout')
@Controller('checkout')
@UseGuards(JwtAuthGuardAll)
@ApiBearerAuth()
export class CheckoutController {
    constructor(private readonly checkoutService: CheckoutService) { }

    // Carrinho
    @Post('cart')
    @ApiOperation({ summary: 'Adicionar item ao carrinho' })
    @ApiResponse({ status: 201, description: 'Item adicionado com sucesso', type: CheckoutItemDto })
    @ApiResponse({ status: 404, description: 'Livro não encontrado' })
    async addToCart(@Request() req, @Body() data: AddToCartDto): Promise<CheckoutItem> {
        return this.checkoutService.addToCart(req.user.id, data);
    }

    @Get('cart')
    @ApiOperation({ summary: 'Obter itens do carrinho' })
    @ApiResponse({ status: 200, description: 'Lista de itens do carrinho', type: [CheckoutItemDto] })
    async getCart(@Request() req): Promise<CheckoutItem[]> {
        return this.checkoutService.getCart(req.user.id);
    }

    @Put('cart/:id')
    @ApiOperation({ summary: 'Atualizar item do carrinho' })
    @ApiParam({ name: 'id', description: 'ID do item do carrinho' })
    @ApiResponse({ status: 200, description: 'Item atualizado com sucesso', type: CheckoutItemDto })
    @ApiResponse({ status: 404, description: 'Item do carrinho não encontrado' })
    async updateCartItem(
        @Request() req,
        @Param('id', ParseIntPipe) cartItemId: number,
        @Body() data: UpdateCartItemDto
    ): Promise<CheckoutItem> {
        return this.checkoutService.updateCartItem(req.user.id, cartItemId, data);
    }

    @Delete('cart/:id')
    @ApiOperation({ summary: 'Remover item do carrinho' })
    @ApiParam({ name: 'id', description: 'ID do item do carrinho' })
    @ApiResponse({ status: 200, description: 'Item removido com sucesso' })
    @ApiResponse({ status: 404, description: 'Item do carrinho não encontrado' })
    async removeFromCart(
        @Request() req,
        @Param('id', ParseIntPipe) cartItemId: number
    ): Promise<void> {
        return this.checkoutService.removeFromCart(req.user.id, cartItemId);
    }

    @Delete('cart')
    @ApiOperation({ summary: 'Limpar carrinho' })
    @ApiResponse({ status: 200, description: 'Carrinho limpo com sucesso' })
    async clearCart(@Request() req): Promise<void> {
        return this.checkoutService.clearCart(req.user.id);
    }

    @Post('cart/select')
    @ApiOperation({ summary: 'Selecionar itens do carrinho' })
    @ApiResponse({ status: 200, description: 'Itens selecionados com sucesso', type: [CheckoutItemDto] })
    async selectCartItems(@Request() req, @Body() data: SelectCartItemsDto): Promise<CheckoutItem[]> {
        return this.checkoutService.selectCartItems(req.user.id, data);
    }

    // Checkout
    @Get('state')
    @ApiOperation({ summary: 'Obter estado do checkout' })
    @ApiResponse({ status: 200, description: 'Estado do checkout', type: CheckoutStateDto })
    async getCheckoutState(@Request() req): Promise<CheckoutState> {
        return this.checkoutService.getCheckoutState(req.user.id);
    }

    // Pedidos
    @Post('orders')
    @ApiOperation({ summary: 'Criar novo pedido' })
    @ApiResponse({ status: 201, description: 'Pedido criado com sucesso', type: OrderResponseDto })
    @ApiResponse({ status: 400, description: 'Dados inválidos' })
    async createOrder(@Request() req, @Body() data: CreateOrderDto): Promise<OrderResponseDto> {
        return this.checkoutService.createOrder(req.user.id, data);
    }

    @Post('orders/book')
    @ApiOperation({ summary: 'Criar pedido direto de um livro (sem carrinho)' })
    @ApiResponse({ status: 201, description: 'Pedido criado com sucesso', type: OrderResponseDto })
    async createOrderFromBook(@Request() req, @Body() data: CreateOrderFromBookDto): Promise<OrderResponseDto> {
        return this.checkoutService.createOrderFromBook(req.user.id, data);
    }

    @Get('orders')
    @ApiOperation({ summary: 'Listar pedidos do usuário' })
    @ApiQuery({ name: 'page', required: false, type: Number })
    @ApiQuery({ name: 'limit', required: false, type: Number })
    @ApiQuery({ name: 'status', required: false, enum: ['pending', 'paid', 'cancelled', 'delivered'] })
    @ApiResponse({ status: 200, description: 'Lista de pedidos' })
    async getOrders(@Request() req, @Query() query: OrderQueryDto) {
        return this.checkoutService.getOrders(req.user.id, query);
    }

    @Get('orders/:id')
    @ApiOperation({ summary: 'Obter pedido por ID' })
    @ApiParam({ name: 'id', description: 'ID do pedido' })
    @ApiResponse({ status: 200, description: 'Detalhes do pedido', type: OrderResponseDto })
    @ApiResponse({ status: 404, description: 'Pedido não encontrado' })
    async getOrderById(
        @Request() req,
        @Param('id', ParseIntPipe) orderId: number
    ): Promise<OrderResponseDto> {
        return this.checkoutService.getOrderById(req.user.id, orderId);
    }

    @Post('orders/:id/cancel')
    @ApiOperation({ summary: 'Cancelar pedido' })
    @ApiParam({ name: 'id', description: 'ID do pedido' })
    @ApiResponse({ status: 200, description: 'Pedido cancelado com sucesso', type: OrderResponseDto })
    @ApiResponse({ status: 404, description: 'Pedido não encontrado' })
    @ApiResponse({ status: 400, description: 'Pedido não pode ser cancelado' })
    async cancelOrder(
        @Request() req,
        @Param('id', ParseIntPipe) orderId: number
    ): Promise<OrderResponseDto> {
        return this.checkoutService.cancelOrder(req.user.id, orderId);
    }

    // Endpoints administrativos (apenas para admins)
    @Get('admin/orders')
    @ApiOperation({ summary: 'Listar todos os pedidos (Admin)' })
    @ApiQuery({ name: 'page', required: false, type: Number })
    @ApiQuery({ name: 'limit', required: false, type: Number })
    @ApiQuery({ name: 'status', required: false, enum: ['pending', 'paid', 'cancelled', 'delivered'] })
    @ApiResponse({ status: 200, description: 'Lista de todos os pedidos' })
    async getAllOrders(@Query() query: OrderQueryDto) {
        return this.checkoutService.getAllOrders(query);
    }

    @Put('admin/orders/:id/status')
    @ApiOperation({ summary: 'Atualizar status do pedido (Admin)' })
    @ApiParam({ name: 'id', description: 'ID do pedido' })
    @ApiResponse({ status: 200, description: 'Status atualizado com sucesso', type: OrderResponseDto })
    @ApiResponse({ status: 404, description: 'Pedido não encontrado' })
    async updateOrderStatus(
        @Param('id', ParseIntPipe) orderId: number,
        @Body() data: { status: 'pending' | 'paid' | 'cancelled' | 'delivered' }
    ): Promise<OrderResponseDto> {
        return this.checkoutService.updateOrderStatus(orderId, data.status);
    }
} 