/* eslint-disable prettier/prettier */
import {
  Body,
  Controller,
  Post,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBody, ApiResponse } from '@nestjs/swagger';
import type { PayloadWebhook } from './dom-webhook.service';
import { WebhookService } from './dom-webhook.service';

@ApiTags('Webhook')
@Controller('webhook')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(private readonly webhookService: WebhookService) {}

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
          example: 'brenohslima@gmail.com'
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
          "email": "brenohslima@gmail.com",
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
          "email": "brenohslima@gmail.com",
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
          "email": "brenohslima@gmail.com"
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
          "email": "brenohslima@gmail.com"
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
}
