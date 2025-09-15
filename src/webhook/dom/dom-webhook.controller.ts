/* eslint-disable prettier/prettier */
import {
  Body,
  Controller,
  Post,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBody, ApiResponse } from '@nestjs/swagger';
import type { PayloadWebhook } from './dom-webhook.service';
import { WebhookService } from './dom-webhook.service';
import { CheckoutService } from 'src/checkout/checkout.service';

@ApiTags('Webhook')
@Controller('webhook')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(
    private readonly webhookService: WebhookService,
    private readonly checkoutService: CheckoutService,
  ) { }

  @Post()
  @ApiOperation({ summary: 'Processa webhooks de pagamento' })
  @ApiBody({ type: Object, description: 'Payload do webhook' })
  @ApiResponse({ status: 200, description: 'Webhook processado com sucesso' })
  @ApiResponse({ status: 400, description: 'Erro ao processar webhook' })
  async handleWebhook(@Body() payload: PayloadWebhook) {
    this.logger.log(`Recebido webhook: ${JSON.stringify(payload)}`);
    this.logger.log(`Tipo do webhook: ${payload.type}`);
    this.logger.log(`Cliente: ${payload.data.customer.name} (${payload.data.customer.email})`);

    try {
      await this.webhookService.handleWebhook(payload);

      let actionTaken = 'Nenhuma ação realizada';
      let details = {};

      if (payload.type === 'SIGNATURE-CREATED') {
        actionTaken = 'Usuário criado';
        details = {
          userEmail: payload.data.customer.email,
          userName: payload.data.customer.name,
          role: 'ADMIN',
          subscriptionId: payload.data.subscription.id,
          planDescription: payload.data.plan.description,
        };
      } else if (payload.type === 'SIGNATURE-CANCELLED') {
        actionTaken = 'Usuário desativado';
        details = {
          userEmail: payload.data.customer.email,
          subscriptionId: payload.data.subscription.id,
        };
      } else if (payload.type === 'SIGNATURE-INVOICE-CREATED') {
        actionTaken = 'Notificação de fatura criada enviada';
        details = {
          userEmail: payload.data.customer.email,
          userName: payload.data.customer.name,
          planDescription: payload.data.plan.description,
          planValue: payload.data.plan.value,
          subscriptionId: payload.data.subscription.id,
        };
      } else if (payload.type === 'SIGNATURE-INVOICE-PAID') {
        actionTaken = 'Notificação de fatura paga enviada';
        details = {
          userEmail: payload.data.customer.email,
          userName: payload.data.customer.name,
          planDescription: payload.data.plan.description,
          planValue: payload.data.plan.value,
          subscriptionId: payload.data.subscription.id,
        };
      }

      this.logger.log(`Webhook processado com sucesso. Ação: ${actionTaken}`);

      return {
        success: true,
        message: 'Webhook processado com sucesso',
        actionTaken,
        webhookType: payload.type,
        details,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      this.logger.error(`Erro ao processar webhook: ${error.message}`, error.stack);

      return {
        success: false,
        message: 'Falha ao processar webhook',
        webhookType: payload.type,
        error: {
          message: error.message,
          stack: process.env.NODE_ENV === 'production' ? undefined : error.stack
        },
        timestamp: new Date().toISOString()
      };
    }
  }

  @Post('debug-user-orders')
  @ApiOperation({
    summary: 'Debug: Lista todos os pedidos de um usuário',
    description: 'Endpoint para debug - lista todos os pedidos de um email específico'
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        email: {
          type: 'string',
          example: 'gabrielpg.at@gmail.com',
          description: 'Email do usuário para buscar pedidos'
        }
      },
      required: ['email']
    }
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de pedidos do usuário'
  })
  async debugUserOrders(@Body() data: { email: string }) {
    const logger = new Logger('DebugUserOrders');
    logger.log(`Buscando pedidos para o email: ${data.email}`);

    const prisma = this.webhookService['prismaService'] || this.webhookService['prisma'];

    try {
      // Buscar usuário
      const user = await prisma.user.findUnique({
        where: { email: data.email },
        include: {
          orders: {
            include: {
              orderItems: {
                include: {
                  book: true
                }
              }
            },
            orderBy: { createdAt: 'desc' }
          }
        }
      });

      if (!user) {
        return {
          success: false,
          message: 'Usuário não encontrado',
          email: data.email
        };
      }

      return {
        success: true,
        message: 'Pedidos encontrados',
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          isActive: user.isActive
        },
        orders: user.orders.map(order => ({
          id: order.id,
          orderNumber: order.orderNumber,
          status: order.status,
          paymentStatus: order.paymentStatus,
          totalAmount: order.totalAmount,
          createdAt: order.createdAt,
          items: order.orderItems.map(item => ({
            bookId: item.bookId,
            bookTitle: item.book.title,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            totalPrice: item.totalPrice
          }))
        })),
        totalOrders: user.orders.length,
        pendingOrders: user.orders.filter(o => o.status === 'pending').length,
        paidOrders: user.orders.filter(o => o.status === 'paid').length
      };
    } catch (error) {
      logger.error(`Erro ao buscar pedidos: ${error.message}`);
      return {
        success: false,
        message: 'Erro ao buscar pedidos',
        error: error.message
      };
    }
  }

  @Post('debug-book-orders')
  @ApiOperation({
    summary: 'Debug: Lista todos os pedidos de um livro',
    description: 'Endpoint para debug - lista todos os pedidos que contêm um livro específico'
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        bookTitle: {
          type: 'string',
          example: 'O Senhor dos Anéis',
          description: 'Título do livro para buscar pedidos'
        }
      },
      required: ['bookTitle']
    }
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de pedidos do livro'
  })
  async debugBookOrders(@Body() data: { bookTitle: string }) {
    const logger = new Logger('DebugBookOrders');
    logger.log(`Buscando pedidos para o livro: ${data.bookTitle}`);

    const prisma = this.webhookService['prismaService'] || this.webhookService['prisma'];

    try {
      // Buscar livro
      const book = await prisma.book.findFirst({
        where: { title: data.bookTitle },
        include: {
          orderItems: {
            include: {
              order: {
                include: {
                  user: true,
                  orderItems: {
                    include: {
                      book: true
                    }
                  }
                }
              }
            }
          }
        }
      });

      if (!book) {
        return {
          success: false,
          message: 'Livro não encontrado',
          bookTitle: data.bookTitle
        };
      }

      const orders = book.orderItems.map(item => item.order);

      return {
        success: true,
        message: 'Pedidos encontrados',
        book: {
          id: book.id,
          title: book.title,
          author: book.author,
          price: book.price,
          isFree: book.isFree,
          isActive: book.isActive
        },
        orders: orders.map(order => ({
          id: order.id,
          orderNumber: order.orderNumber,
          status: order.status,
          paymentStatus: order.paymentStatus,
          totalAmount: order.totalAmount,
          createdAt: order.createdAt,
          user: {
            id: order.user.id,
            email: order.user.email,
            name: order.user.name
          },
          items: order.orderItems.map(item => ({
            bookId: item.bookId,
            bookTitle: item.book.title,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            totalPrice: item.totalPrice
          }))
        })),
        totalOrders: orders.length,
        pendingOrders: orders.filter(o => o.status === 'pending').length,
        paidOrders: orders.filter(o => o.status === 'paid').length
      };
    } catch (error) {
      logger.error(`Erro ao buscar pedidos do livro: ${error.message}`);
      return {
        success: false,
        message: 'Erro ao buscar pedidos do livro',
        error: error.message
      };
    }
  }

  @Post('debug-payment-issue')
  @ApiOperation({
    summary: 'Debug: Investigar problema de confirmação de pagamento',
    description: 'Endpoint para investigar por que a confirmação de pagamento não está funcionando'
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        email: {
          type: 'string',
          example: 'gabrielpg.at@gmail.com',
          description: 'Email do usuário para investigar'
        },
        possibleOrderNumber: {
          type: 'string',
          example: 'O Senhor dos Anéis5',
          description: 'Possível orderNumber ou título do livro (opcional)'
        }
      },
      required: ['email']
    }
  })
  @ApiResponse({
    status: 200,
    description: 'Análise completa do problema'
  })
  async debugPaymentIssue(@Body() data: { email: string, possibleOrderNumber?: string }) {
    const logger = new Logger('DebugPaymentIssue');
    logger.log(`Investigando problema para email: ${data.email}`);

    const prisma = this.webhookService['prismaService'] || this.webhookService['prisma'];

    try {
      // 1. Verificar se usuário existe
      const user = await prisma.user.findUnique({
        where: { email: data.email.toLowerCase().trim() }
      });

      if (!user) {
        return {
          success: false,
          message: 'Usuário não encontrado',
          email: data.email,
          recommendations: [
            'Verifique se o email está correto',
            'Verifique se o usuário foi criado no sistema',
            'Teste com o endpoint de criação de usuário'
          ]
        };
      }

      // 2. Buscar todos os pedidos do usuário
      const allOrders = await prisma.order.findMany({
        where: { userId: user.id },
        include: {
          orderItems: { include: { book: true } }
        },
        orderBy: { createdAt: 'desc' }
      });

      // 3. Buscar todos os livros disponíveis
      const allBooks = await prisma.book.findMany({
        select: { id: true, title: true, author: true, price: true, isActive: true }
      });

      // 4. Buscar itens no carrinho
      const cartItems = await prisma.cart.findMany({
        where: { userId: user.id },
        include: { book: true }
      });

      // 5. Gerar recomendações
      const recommendations: string[] = [];
      if (allOrders.length === 0) {
        recommendations.push('Usuário não tem pedidos - criar um pedido primeiro');
      }
      if (cartItems.length > 0) {
        recommendations.push('Usuário tem itens no carrinho - considere criar pedido a partir do carrinho');
      }
      if (allOrders.filter(o => o.status === 'pending').length === 0) {
        recommendations.push('Nenhum pedido pendente - todos os pedidos já foram processados');
      }

      return {
        success: true,
        message: 'Análise completa do usuário',
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          isActive: user.isActive,
          createdAt: user.createdAt
        },
        orders: {
          total: allOrders.length,
          pending: allOrders.filter(o => o.status === 'pending').length,
          paid: allOrders.filter(o => o.status === 'paid').length,
          cancelled: allOrders.filter(o => o.status === 'cancelled').length,
          list: allOrders.map(order => ({
            id: order.id,
            orderNumber: order.orderNumber,
            status: order.status,
            paymentStatus: order.paymentStatus,
            totalAmount: order.totalAmount,
            createdAt: order.createdAt,
            items: order.orderItems.map(item => ({
              bookId: item.bookId,
              bookTitle: item.book.title,
              quantity: item.quantity,
              unitPrice: item.unitPrice
            }))
          }))
        },
        cart: {
          total: cartItems.length,
          items: cartItems.map(item => ({
            id: item.id,
            bookId: item.bookId,
            bookTitle: item.book.title,
            quantity: item.quantity,
            selected: item.selected
          }))
        },
        books: {
          total: allBooks.length,
          active: allBooks.filter(b => b.isActive).length,
          sample: allBooks.slice(0, 5)
        },
        possibleMatches: data.possibleOrderNumber ? {
          exactOrderNumber: allOrders.find(o => o.orderNumber === data.possibleOrderNumber),
          bookByTitle: allBooks.find(b => b.title.includes(data.possibleOrderNumber)),
          ordersByBookTitle: allOrders.filter(o =>
            o.orderItems.some(item =>
              item.book.title.toLowerCase().includes(data.possibleOrderNumber.toLowerCase())
            )
          )
        } : null,
        recommendations
      };

    } catch (error) {
      logger.error(`Erro na investigação: ${error.message}`);
      return {
        success: false,
        message: 'Erro ao investigar problema',
        error: error.message
      };
    }
  }

  @Post('test-signature-created')
  @ApiOperation({
    summary: 'Testa o processamento de webhook para "SIGNATURE-CREATED"',
    description: 'Simula o recebimento de um evento de criação de assinatura para testar a criação de usuário e envio de email'
  })
  @ApiResponse({
    status: 200,
    description: 'Teste de webhook executado com sucesso',
    schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean',
          example: true
        },
        message: {
          type: 'string',
          example: 'Webhook processado com sucesso'
        },
        userEmail: {
          type: 'string',
          example: 'gabriel5647546@gmail.com'
        },
        userName: {
          type: 'string',
          example: 'Breno Henrique de Souza Lima'
        },
        webhookType: {
          type: 'string',
          example: 'SIGNATURE-CREATED'
        }
      }
    }
  })
  async testSignatureCreated() {
    this.logger.log('Iniciando teste de webhook para SIGNATURE-CREATED');

    const payload = {
      "type": "SIGNATURE-CREATED",
      "data": {
        "customer": {
          "dom_customer_id": "eeacab24-81a2-453c-85b9-68a2364f9045",
          "email": "gabriel5647546@gmail.com",
          "name": "Breno Henrique de Souza Lima"
        },
        "subscription": {
          "id": "15c35216-afa2-4ee0-905a-bb39e3976430",
          "status": "ACTIVE",
          "external_reference": "d8d7c125-016c-4005-90db-dd766252f60c:64bbe6ea-a378-4378-9cb9-3a1bd65b6171"
        },
        "plan": {
          "id": "46de3445-2d4a-4aa6-9068-dbca18d931ec",
          "dom_plan_id": "534d730b-83d0-4930-b956-4c4c3b93a3f7",
          "value": 1,
          "description": "Plano de Teste",
          "external_reference": "a5fcd56b-dc1c-48a3-9529-1e50bd052c9d:292b1905-c922-460d-b4d2-00aa607a1d1a"
        }
      }
    };

    try {
      await this.webhookService.handleWebhook(payload);

      this.logger.log('Teste de webhook concluído com sucesso');

      return {
        success: true,
        message: 'Webhook de criação de assinatura processado com sucesso',
        userEmail: payload.data.customer.email,
        userName: payload.data.customer.name,
        webhookType: payload.type,
        subscriptionId: payload.data.subscription.id,
        planDescription: payload.data.plan.description,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      this.logger.error(`Erro no teste de webhook: ${error.message}`, error.stack);

      return {
        success: false,
        message: 'Falha ao processar webhook de teste',
        error: error.message,
        stack: process.env.NODE_ENV === 'production' ? undefined : error.stack,
        timestamp: new Date().toISOString()
      };
    }
  }

  @Post('test-signature-cancelled')
  @ApiOperation({
    summary: 'Testa o processamento de webhook para "SIGNATURE-CANCELLED"',
    description: 'Simula o recebimento de um evento de cancelamento de assinatura para testar a desativação de usuário e envio de email'
  })
  @ApiResponse({
    status: 200,
    description: 'Teste de webhook executado com sucesso'
  })
  async testSignatureCancelled() {
    this.logger.log('Iniciando teste de webhook para SIGNATURE-CANCELLED');

    const payload = {
      "type": "SIGNATURE-CANCELLED",
      "data": {
        "customer": {
          "dom_customer_id": "eeacab24-81a2-453c-85b9-68a2364f9045",
          "email": "gabriel5647546@gmail.com",
          "name": "Breno Henrique de Souza Lima"
        },
        "subscription": {
          "id": "15c35216-afa2-4ee0-905a-bb39e3976430",
          "status": "CANCELLED",
          "external_reference": "d8d7c125-016c-4005-90db-dd766252f60c:64bbe6ea-a378-4378-9cb9-3a1bd65b6171"
        },
        "plan": {
          "id": "46de3445-2d4a-4aa6-9068-dbca18d931ec",
          "dom_plan_id": "534d730b-83d0-4930-b956-4c4c3b93a3f7",
          "value": 1,
          "description": "Plano de Teste",
          "external_reference": "a5fcd56b-dc1c-48a3-9529-1e50bd052c9d:292b1905-c922-460d-b4d2-00aa607a1d1a"
        }
      }
    };

    try {
      await this.webhookService.handleWebhook(payload);

      this.logger.log('Teste de webhook concluído com sucesso');

      return {
        success: true,
        message: 'Webhook de cancelamento de assinatura processado com sucesso',
        userEmail: payload.data.customer.email,
        userName: payload.data.customer.name,
        webhookType: payload.type,
        subscriptionId: payload.data.subscription.id,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      this.logger.error(`Erro no teste de webhook: ${error.message}`, error.stack);

      return {
        success: false,
        message: 'Falha ao processar webhook de teste',
        error: error.message,
        stack: process.env.NODE_ENV === 'production' ? undefined : error.stack,
        timestamp: new Date().toISOString()
      };
    }
  }

  @Post('test-invoice-created')
  @ApiOperation({
    summary: 'Testa o processamento de webhook para "SIGNATURE-INVOICE-CREATED"',
    description: 'Simula o recebimento de um evento de criação de fatura para testar o envio de notificação por email'
  })
  @ApiResponse({
    status: 200,
    description: 'Teste de webhook executado com sucesso'
  })
  async testInvoiceCreated() {
    this.logger.log('Iniciando teste de webhook para SIGNATURE-INVOICE-CREATED');

    const payload = {
      "type": "SIGNATURE-INVOICE-CREATED",
      "data": {
        "customer": {
          "id": "7db67756-19f7-472a-88fd-99d993d4d14c",
          "name": "Breno Henrique de Souza Lima",
          "email": "gabriel5647546@gmail.com"
        },
        "plan": {
          "id": "a8607237-4ea8-495d-a710-b90ca5469f1f",
          "value": 1,
          "description": "Plano Mensal",
          "external_reference": "034d93d6-104e-48e2-a807-6ba828742606:7db67756-19f7-472a-88fd-99d993d4d14c"
        },
        "subscription": {
          "id": "bcf00be2-d95f-4f6b-a41a-033d26f81df1",
          "status": "active",
          "external_reference": "034d93d6-104e-48e2-a807-6ba828742606:7db67756-19f7-472a-88fd-99d993d4d14c"
        }
      }
    };

    try {
      await this.webhookService.handleWebhook(payload);

      this.logger.log('Teste de webhook de criação de fatura concluído com sucesso');

      return {
        success: true,
        message: 'Webhook de criação de fatura processado com sucesso',
        userEmail: payload.data.customer.email,
        userName: payload.data.customer.name,
        webhookType: payload.type,
        planDescription: payload.data.plan.description,
        planValue: payload.data.plan.value,
        subscriptionId: payload.data.subscription.id,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      this.logger.error(`Erro no teste de webhook de criação de fatura: ${error.message}`, error.stack);

      return {
        success: false,
        message: 'Falha ao processar webhook de teste de criação de fatura',
        error: error.message,
        stack: process.env.NODE_ENV === 'production' ? undefined : error.stack,
        timestamp: new Date().toISOString()
      };
    }
  }

  @Post('test-invoice-paid')
  @ApiOperation({
    summary: 'Testa o processamento de webhook para "SIGNATURE-INVOICE-PAID"',
    description: 'Simula o recebimento de um evento de pagamento de fatura para testar o envio de confirmação por email'
  })
  @ApiResponse({
    status: 200,
    description: 'Teste de webhook executado com sucesso'
  })
  async testInvoicePaid() {
    this.logger.log('Iniciando teste de webhook para SIGNATURE-INVOICE-PAID');

    const payload = {
      "type": "SIGNATURE-INVOICE-PAID",
      "data": {
        "customer": {
          "id": "7db67756-19f7-472a-88fd-99d993d4d14c",
          "name": "Breno Henrique de Souza Lima",
          "email": "gabriel5647546@gmail.com"
        },
        "plan": {
          "id": "a8607237-4ea8-495d-a710-b90ca5469f1f",
          "value": 1,
          "description": "Plano Mensal",
          "external_reference": "034d93d6-104e-48e2-a807-6ba828742606:7db67756-19f7-472a-88fd-99d993d4d14c"
        },
        "subscription": {
          "id": "bcf00be2-d95f-4f6b-a41a-033d26f81df1",
          "status": "active",
          "external_reference": "034d93d6-104e-48e2-a807-6ba828742606:7db67756-19f7-472a-88fd-99d993d4d14c"
        }
      }
    };

    try {
      await this.webhookService.handleWebhook(payload);

      this.logger.log('Teste de webhook de pagamento de fatura concluído com sucesso');

      return {
        success: true,
        message: 'Webhook de pagamento de fatura processado com sucesso',
        userEmail: payload.data.customer.email,
        userName: payload.data.customer.name,
        webhookType: payload.type,
        planDescription: payload.data.plan.description,
        planValue: payload.data.plan.value,
        subscriptionId: payload.data.subscription.id,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      this.logger.error(`Erro no teste de webhook de pagamento de fatura: ${error.message}`, error.stack);

      return {
        success: false,
        message: 'Falha ao processar webhook de teste de pagamento de fatura',
        error: error.message,
        stack: process.env.NODE_ENV === 'production' ? undefined : error.stack,
        timestamp: new Date().toISOString()
      };
    }
  }

  @Post('payment-confirmation')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        orderNumber: { type: 'string', example: 'ORD-2025-243164' },
        status: { type: 'string', example: 'COMPLETED' },
        email: { type: 'string', example: 'usuario@exemplo.com' },
        store: { type: 'string', example: 'ebook', description: 'Identifica a plataforma de origem' }
      },
      required: ['orderNumber', 'status']
    }
  })
  async confirmPayment(@Body() data: { orderNumber: string, status: string, email?: string, store?: string }) {
    const logger = new Logger('PaymentConfirmation');
    logger.log(`Recebida confirmação de pagamento: ${JSON.stringify(data)}`);

    // Validação básica
    if (!data || !data.orderNumber || !data.status) {
      logger.error('Payload inválido: orderNumber e status são obrigatórios');
      throw new BadRequestException('orderNumber e status são obrigatórios');
    }

    if (data.status === 'paid' || data.status === 'COMPLETED') {
      const prisma = this.webhookService['prismaService'] || this.webhookService['prisma'];

      try {
        // ESTRATÉGIA 1: Buscar por orderNumber exato
        logger.log(`Tentativa 1: Buscando pedido por orderNumber exato: ${data.orderNumber}`);
        let existingOrder = await prisma.order.findUnique({
          where: { orderNumber: data.orderNumber },
          include: {
            orderItems: { include: { book: true } },
            user: true
          }
        });

        if (existingOrder) {
          logger.log(`✅ Pedido encontrado por orderNumber: ${existingOrder.orderNumber}`);
          const updated = await prisma.order.update({
            where: { id: existingOrder.id },
            data: { 
              status: 'paid', 
              paymentStatus: 'paid',
              store: data.store || 'ebook' // Default para 'ebook' se não especificado
            }
          });

          await this.webhookService.notificationService.notifyOrderStatusUpdate(
            existingOrder.userId,
            existingOrder.orderNumber,
            'paid'
          );

          await this.checkoutService.removeOrderBooksFromCart(existingOrder.userId, existingOrder.id);


          await this.checkoutService.sendPurchaseConfirmationEmail(existingOrder.id);


          await this.updateBooksSalesCount(existingOrder.orderItems);

          return {
            ok: true,
            message: `Pedido ${existingOrder.orderNumber} atualizado com sucesso`,
            orderNumber: existingOrder.orderNumber,
            strategy: 'exact_orderNumber'
          };
        }

        if (data.email) {
          logger.log(`Tentativa 2: Buscando pedidos pendentes para email: ${data.email}`);

          const pendingOrders = await prisma.order.findMany({
            where: {
              user: { email: data.email.toLowerCase().trim() },
              status: 'pending'
            },
            include: {
              orderItems: { include: { book: true } },
              user: true
            },
            orderBy: { createdAt: 'desc' }
          });

          logger.log(`Encontrados ${pendingOrders.length} pedidos pendentes para ${data.email}`);

          if (pendingOrders.length > 0) {
            // Pegar o pedido mais recente
            const mostRecentOrder = pendingOrders[0];
            logger.log(`✅ Usando pedido mais recente: ${mostRecentOrder.orderNumber}`);

            const updated = await prisma.order.update({
              where: { id: mostRecentOrder.id },
              data: { 
                status: 'paid', 
                paymentStatus: 'paid',
                store: data.store || 'ebook'
              }
            });

            await this.webhookService.notificationService.notifyOrderStatusUpdate(
              mostRecentOrder.userId,
              mostRecentOrder.orderNumber,
              'paid'
            );

            await this.checkoutService.removeOrderBooksFromCart(mostRecentOrder.userId, mostRecentOrder.id);

            await this.checkoutService.sendPurchaseConfirmationEmail(mostRecentOrder.id);

            await this.updateBooksSalesCount(mostRecentOrder.orderItems);

            return {
              ok: true,
              message: `Pedido ${mostRecentOrder.orderNumber} atualizado com sucesso`,
              orderNumber: mostRecentOrder.orderNumber,
              strategy: 'most_recent_pending',
              totalPendingOrders: pendingOrders.length,
              originalOrderNumber: data.orderNumber
            };
          }
        }

        if (data.email) {
          logger.log(`Tentativa 3: Buscando por título do livro: ${data.orderNumber}`);

          const book = await prisma.book.findFirst({
            where: {
              OR: [
                { title: { contains: data.orderNumber, mode: 'insensitive' } },
                { title: data.orderNumber }
              ]
            }
          });

          if (book) {
            logger.log(`✅ Livro encontrado: ${book.title} (ID: ${book.id})`);

            const orderWithBook = await prisma.order.findFirst({
              where: {
                user: { email: data.email.toLowerCase().trim() },
                orderItems: {
                  some: { bookId: book.id }
                },
                status: { in: ['pending', 'paid'] } 
              },
              include: {
                orderItems: { include: { book: true } },
                user: true
              },
              orderBy: { createdAt: 'desc' }
            });

            if (orderWithBook) {
              logger.log(`✅ Pedido encontrado por livro: ${orderWithBook.orderNumber}`);

              if (orderWithBook.status === 'pending') {
                const updated = await prisma.order.update({
                  where: { id: orderWithBook.id },
                  data: { 
                status: 'paid', 
                paymentStatus: 'paid',
                store: data.store || 'ebook'
              }
                });

                await this.webhookService.notificationService.notifyOrderStatusUpdate(
                  orderWithBook.userId,
                  orderWithBook.orderNumber,
                  'paid'
                );

                await this.checkoutService.sendPurchaseConfirmationEmail(orderWithBook.id);

                await this.updateBooksSalesCount(orderWithBook.orderItems);

                return {
                  ok: true,
                  message: `Pedido ${orderWithBook.orderNumber} atualizado com sucesso`,
                  orderNumber: orderWithBook.orderNumber,
                  strategy: 'found_by_book_title',
                  bookTitle: book.title,
                  originalOrderNumber: data.orderNumber
                };
              } else {
                return {
                  ok: true,
                  message: `Pedido ${orderWithBook.orderNumber} já estava pago`,
                  orderNumber: orderWithBook.orderNumber,
                  strategy: 'found_by_book_title_already_paid',
                  bookTitle: book.title,
                  originalOrderNumber: data.orderNumber
                };
              }
            }
          }
        }

        if (data.email) {
          logger.log(`Tentativa 4: Buscando TODOS os pedidos para debug: ${data.email}`);

          const allOrders = await prisma.order.findMany({
            where: {
              user: { email: data.email.toLowerCase().trim() }
            },
            include: {
              orderItems: { include: { book: true } },
              user: true
            },
            orderBy: { createdAt: 'desc' }
          });

          logger.log(`Total de pedidos encontrados para ${data.email}: ${allOrders.length}`);

          allOrders.forEach((order, index) => {
            logger.log(`Pedido ${index + 1}: ${order.orderNumber} - Status: ${order.status} - Criado em: ${order.createdAt}`);
            order.orderItems.forEach((item, itemIndex) => {
              logger.log(`  Item ${itemIndex + 1}: ${item.book.title} (ID: ${item.book.id})`);
            });
          });

          if (allOrders.length > 0) {
            const latestOrder = allOrders[0];
            logger.log(`✅ Usando último pedido como fallback: ${latestOrder.orderNumber}`);

            if (latestOrder.status !== 'paid') {
              const updated = await prisma.order.update({
                where: { id: latestOrder.id },
                data: { 
                status: 'paid', 
                paymentStatus: 'paid',
                store: data.store || 'ebook'
              }
              });

              await this.webhookService.notificationService.notifyOrderStatusUpdate(
                latestOrder.userId,
                latestOrder.orderNumber,
                'paid'
              );

              await this.checkoutService.sendPurchaseConfirmationEmail(latestOrder.id);

              await this.updateBooksSalesCount(latestOrder.orderItems);

              return {
                ok: true,
                message: `Pedido ${latestOrder.orderNumber} atualizado como último recurso`,
                orderNumber: latestOrder.orderNumber,
                strategy: 'latest_order_fallback',
                originalStatus: latestOrder.status,
                originalOrderNumber: data.orderNumber,
                totalOrdersFound: allOrders.length
              };
            } else {
              return {
                ok: true,
                message: `Último pedido ${latestOrder.orderNumber} já estava pago`,
                orderNumber: latestOrder.orderNumber,
                strategy: 'latest_order_already_paid',
                originalOrderNumber: data.orderNumber,
                totalOrdersFound: allOrders.length
              };
            }
          }
        }

        logger.error(`❌ Nenhuma estratégia funcionou para encontrar pedido`);
        logger.error(`OrderNumber recebido: ${data.orderNumber}`);
        logger.error(`Email: ${data.email}`);

        throw new BadRequestException({
          message: 'Pedido não encontrado com nenhuma estratégia',
          orderNumber: data.orderNumber,
          email: data.email,
          strategies_tried: [
            'exact_orderNumber',
            'pending_orders_by_email',
            'book_title_search',
            'all_orders_debug'
          ]
        });

      } catch (err) {
        logger.error(`Erro ao processar confirmação de pagamento: ${err.message}`);
        logger.error(`Stack trace: ${err.stack}`);
        throw new BadRequestException({
          message: 'Erro interno ao processar confirmação de pagamento',
          error: err.message,
          orderNumber: data.orderNumber,
          email: data.email
        });
      }
    }

    return {
      ok: true,
      message: `Status ${data.status} recebido, mas não requer atualização`,
      orderNumber: data.orderNumber
    };
  }

  @Post('test-payment-confirmation')
  @ApiOperation({
    summary: 'Testa o endpoint de confirmação de pagamento',
    description: 'Simula uma confirmação de pagamento para testar o sistema'
  })
  @ApiResponse({
    status: 200,
    description: 'Teste de confirmação de pagamento executado com sucesso'
  })
  async testPaymentConfirmation() {
    const logger = new Logger('TestPaymentConfirmation');
    logger.log('Iniciando teste de confirmação de pagamento');

    const testOrder = await this.webhookService['prismaService'].order.create({
      data: {
        userId: 'test-user-id',
        orderNumber: `TEST-${Date.now()}`,
        status: 'pending',
        totalAmount: 49.90,
        subtotal: 49.90,
        tax: 0,
        discount: 0,
        paymentMethod: 'credit_card',
        paymentStatus: 'pending',
        notes: 'Pedido de teste para confirmação de pagamento'
      }
    });

    logger.log(`Pedido de teste criado: ${testOrder.orderNumber}`);

    const testData = {
      orderNumber: testOrder.orderNumber,
      status: 'COMPLETED',
      email: 'test@example.com'
    };

    try {
      const result = await this.confirmPayment(testData);
      logger.log('Teste de confirmação de pagamento concluído com sucesso');

      return {
        success: true,
        message: 'Teste de confirmação de pagamento executado com sucesso',
        testOrder: testOrder.orderNumber,
        result
      };
    } catch (error) {
      logger.error(`Erro no teste de confirmação de pagamento: ${error.message}`);

      return {
        success: false,
        message: 'Falha no teste de confirmação de pagamento',
        error: error.message,
        testOrder: testOrder.orderNumber
      };
    }
  }

  /**
   * Atualiza o contador de vendas dos livros de um pedido
   */
  private async updateBooksSalesCount(orderItems: any[]): Promise<void> {
    try {
      for (const item of orderItems) {

        const book = await this.webhookService['prismaService']?.book.findUnique({
          where: { id: item.bookId },
          select: { sales: true }
        });

        if (!book) {
          this.logger.warn(`⚠️ Livro ${item.bookId} não encontrado para atualizar vendas`);
          continue;
        }

        const newSalesCount = (book.sales || 0) + item.quantity;

        await this.webhookService['prismaService']?.book.update({
          where: { id: item.bookId },
          data: { sales: newSalesCount }
        });

        this.logger.log(`✅ Vendas do livro ${item.bookId} atualizadas: ${book.sales || 0} → ${newSalesCount} (+${item.quantity})`);
      }
    } catch (error) {
      this.logger.error(`❌ Erro ao atualizar vendas dos livros:`, error);
    }
  }

  /**
   * 🚀 ENDPOINT ADMIN: Contabiliza vendas passadas dos livros que JÁ FORAM VENDIDOS
   * Executar APENAS UMA VEZ para migrar dados históricos
   */
  @Post('admin/recalculate-all-sales')
  @ApiOperation({
    summary: 'Recalcula contadores de vendas dos livros que já foram vendidos',
    description: 'Executa uma migração para contabilizar vendas passadas baseado no histórico de pedidos pagos'
  })
  @ApiResponse({
    status: 200,
    description: 'Contabilização de vendas passadas concluída com sucesso'
  })
  async recalculateAllSales() {
    const logger = new Logger('RecalculateAllSales');
    logger.log('🚀 Iniciando contabilização de vendas passadas...');

    try {
      // 1. Usar a mesma lógica do comando: groupBy por bookId
      const salesByBook = await this.webhookService['prismaService'].orderItem.groupBy({
        by: ['bookId'],
        where: {
          order: {
            paymentStatus: 'paid'
          }
        },
        _count: {
          bookId: true
        },
        orderBy: {
          _count: {
            bookId: 'desc'
          }
        }
      });

      logger.log(`📊 Encontrados ${salesByBook.length} livros com vendas para processar`);

      if (salesByBook.length === 0) {
        return {
          success: true,
          message: 'Nenhum livro com vendas encontrado para contabilizar',
          summary: {
            totalBooks: 0,
            updatedBooks: 0,
            totalSalesCounted: 0
          },
          books: []
        };
      }

      // 2. Buscar detalhes dos livros e atualizar
      const booksWithSales = await Promise.all(
        salesByBook.map(async sale => {
          const book = await this.webhookService['prismaService'].book.findUnique({
            where: { id: sale.bookId },
            select: { id: true, title: true, author: true, price: true, sales: true }
          });
          
          if (!book) {
            logger.warn(`⚠️ Livro ${sale.bookId} não encontrado`);
            return null;
          }

          return {
            ...book,
            vendasReais: sale._count.bookId
          };
        })
      );

      // 3. Filtrar livros válidos
      const validBooks = booksWithSales.filter(book => book !== null);

      logger.log(`📚 Processando ${validBooks.length} livros válidos`);

      // 4. Atualizar cada livro
      let updatedCount = 0;
      let totalSalesCounted = 0;

      for (const book of validBooks) {
        try {
          await this.webhookService['prismaService'].book.update({
            where: { id: book.id },
            data: { sales: book.vendasReais }
          });

          logger.log(`✅ Livro "${book.title}" (ID: ${book.id}): ${book.sales || 0} → ${book.vendasReais} vendas`);
          updatedCount++;
          totalSalesCounted += book.vendasReais;

        } catch (error) {
          logger.error(`❌ Erro ao atualizar livro ${book.id}:`, error);
        }
      }

      logger.log(`🎉 Contabilização concluída!`);
      logger.log(`📊 Livros atualizados: ${updatedCount}/${validBooks.length}`);
      logger.log(`💰 Total de vendas contabilizadas: ${totalSalesCounted}`);

      return {
        success: true,
        message: 'Contabilização de vendas passadas concluída com sucesso',
        summary: {
          totalBooks: validBooks.length,
          updatedBooks: updatedCount,
          totalSalesCounted
        },
        books: validBooks.map(book => ({
          bookId: book.id,
          title: book.title,
          author: book.author,
          price: book.price,
          previousSales: book.sales || 0,
          newSales: book.vendasReais
        }))
      };

    } catch (error) {
      logger.error(`❌ Erro na contabilização de vendas:`, error);
      throw new BadRequestException(`Falha na contabilização: ${error.message}`);
    }
  }
}
