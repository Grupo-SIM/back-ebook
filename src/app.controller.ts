import { Controller, Get, Post, Body, Param, UseGuards, Req, Res, HttpStatus, Query } from '@nestjs/common';
import { AppService } from './app.service';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiBody } from '@nestjs/swagger';
import { TestEmailDto } from './dto/test-email.dto';
import { MockPurchaseDto } from './dto/mock-purchase.dto';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('App')
@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly prismaService: PrismaService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Health check da API' })
  @ApiResponse({ status: 200, description: 'API funcionando' })
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  @ApiOperation({ summary: 'Status de saúde da API' })
  @ApiResponse({ status: 200, description: 'API saudável' })
  getHealth() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      uptime: process.uptime(),
      memory: process.memoryUsage(),
    };
  }

  @Get('test-routes')
  @ApiOperation({ summary: 'Teste de rotas disponíveis' })
  @ApiResponse({ status: 200, description: 'Rotas listadas' })
  getTestRoutes() {
    return {
      message: 'Rotas de teste disponíveis',
      routes: {
        auth: [
          'POST /auth/user/login',
          'POST /auth/admin/login',
          'POST /auth/customer/login',
        ],
        books: [
          'GET /books/purchased',
          'GET /books/10/download',
          'GET /books/10/purchase-status',
        ],
        test: [
          'GET /test-routes',
          'GET /health',
        ],
      },
      timestamp: new Date().toISOString(),
    };
  }

  @Post('/test-email')
  @ApiOperation({ summary: 'Teste do serviço de email SMTP - Envie um email de teste' })
  @ApiResponse({ status: 200, description: 'Email enviado com sucesso' })
  @ApiResponse({ status: 400, description: 'Erro ao enviar email' })
  async testEmailService(@Body() testEmailDto: TestEmailDto) {
    const email = testEmailDto?.email;
    
    if (!email) {
      return {
        success: false,
        message: 'Por favor, forneça um email no corpo da requisição. Exemplo: { "email": "seu@email.com" }',
        timestamp: new Date().toISOString(),
      };
    }

    try {
      const result = await this.appService.testEmailService(email, 'Usuário de Teste');
      return {
        success: true,
        message: `Email de teste enviado com sucesso para ${email}`,
        details: result,
        timestamp: new Date().toISOString(),
        smtpConfig: {
          host: process.env.SMTP_HOST,
          port: process.env.SMTP_PORT,
          secure: process.env.SMTP_SECURE,
          user: process.env.SMTP_USER,
        }
      };
    } catch (error) {
      return {
        success: false,
        message: 'Erro ao enviar email de teste',
        error: error.message,
        timestamp: new Date().toISOString(),
        smtpConfig: {
          host: process.env.SMTP_HOST,
          port: process.env.SMTP_PORT,
          secure: process.env.SMTP_SECURE,
          user: process.env.SMTP_USER,
        }
      };
    }
  }

  @Post('/mock-purchase')
  @ApiOperation({ 
    summary: '🧪 TESTE: Simular compra de um livro',
    description: 'Cria uma ordem de compra fictícia para testes. O livro ficará disponível como se tivesse sido comprado.'
  })
  @ApiResponse({ status: 200, description: 'Compra simulada com sucesso' })
  @ApiResponse({ status: 404, description: 'Livro ou usuário não encontrado' })
  @ApiResponse({ status: 400, description: 'Erro ao simular compra' })
  async mockPurchase(@Body() mockPurchaseDto: MockPurchaseDto) {
    try {
      // Verificar se o livro existe
      const book = await this.prismaService.book.findUnique({
        where: { id: mockPurchaseDto.bookId },
      });

      if (!book) {
        return {
          success: false,
          message: `Livro com ID ${mockPurchaseDto.bookId} não encontrado`,
          timestamp: new Date().toISOString(),
        };
      }

      // Verificar se o usuário existe
      const user = await this.prismaService.user.findUnique({
        where: { id: mockPurchaseDto.userId },
      });

      if (!user) {
        return {
          success: false,
          message: `Usuário com ID ${mockPurchaseDto.userId} não encontrado`,
          timestamp: new Date().toISOString(),
        };
      }

      const quantity = mockPurchaseDto.quantity || 1;
      const totalPrice = book.price * quantity;

      // Gerar número de pedido único
      const orderNumber = `MOCK-${Date.now()}-${Math.random().toString(36).substring(7).toUpperCase()}`;

      // Criar uma ordem de compra fictícia
      const order = await this.prismaService.order.create({
        data: {
          userId: mockPurchaseDto.userId,
          orderNumber: orderNumber,
          totalAmount: totalPrice,
          subtotal: totalPrice,
          tax: 0,
          discount: 0,
          status: 'paid', // ✅ Status como pago
          paymentStatus: 'paid',
          paymentMethod: 'MOCK_TEST', // Indicar que é teste
          store: 'ebook',
        },
      });

      // Criar o item do pedido
      const orderItem = await this.prismaService.orderItem.create({
        data: {
          orderId: order.id,
          bookId: mockPurchaseDto.bookId,
          quantity: quantity,
          unitPrice: book.price,
          totalPrice: totalPrice,
        },
      });

      // Incrementar vendas do livro
      await this.prismaService.book.update({
        where: { id: mockPurchaseDto.bookId },
        data: {
          sales: {
            increment: quantity,
          },
        },
      });

      return {
        success: true,
        message: `✅ Compra simulada com sucesso! O livro "${book.title}" agora está disponível para ${user.name}`,
        data: {
          order: {
            id: order.id,
            orderNumber: order.orderNumber,
            totalAmount: order.totalAmount,
            status: order.status,
            paymentStatus: order.paymentStatus,
            createdAt: order.createdAt,
          },
          book: {
            id: book.id,
            title: book.title,
            author: book.author,
            price: book.price,
          },
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
          },
          quantity: quantity,
        },
        instructions: {
          download: `GET /books/${book.id}/download`,
          checkStatus: `GET /books/${book.id}/purchase-status`,
          myBooks: `GET /books/purchased`,
        },
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        success: false,
        message: 'Erro ao simular compra',
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }
}
