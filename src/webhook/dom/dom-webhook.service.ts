/* eslint-disable prettier/prettier */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { AuthService } from 'src/auth/auth.service';
import { AppService } from 'src/app.service';
import { NotificationService } from 'src/notification/notification.service';
import { Role } from 'src/types/interfaces/role';
export interface PayloadWebhook {
  type: string;
  data: {
    customer: {
      id?: string;
      dom_customer_id?: string;
      email: string;
      name: string;
    };
    subscription: {
      id: string;
      status: string;
      external_reference: string;
    };
    plan: {
      id: string;
      dom_plan_id?: string;
      value: number;
      description: string;
      external_reference: string;
    };
  };
}

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);
  private emailDebounceMap: Map<string, Date> = new Map();

  constructor(
    private readonly prismaService: PrismaService,
    private readonly authService: AuthService,
    private readonly appService: AppService,
    public readonly notificationService: NotificationService,
  ) { }

  private buildSyntheticCpfFromInput(input: string): string {
    const digits = String(input ?? '').replace(/\D/g, '');
    if (digits.length >= 11) return digits.slice(0, 11);
    return `${digits}${'0'.repeat(11)}`.slice(0, 11);
  }

  private shouldSendEmail(email: string, eventType: string): boolean {
    const key = `${email}-${eventType}`;
    const now = new Date();
    const lastSent = this.emailDebounceMap.get(key);

    if (!lastSent || now.getTime() - lastSent.getTime() > 5 * 60 * 1000) {
      this.emailDebounceMap.set(key, now);

      if (this.emailDebounceMap.size > 1000) {
        const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
        for (const [mapKey, timestamp] of this.emailDebounceMap.entries()) {
          if (timestamp < oneHourAgo) {
            this.emailDebounceMap.delete(mapKey);
          }
        }
      }

      return true;
    }

    this.logger.log(
      `Evitando email duplicado para ${email} (${eventType}) - último envio: ${lastSent.toISOString()}`,
    );
    return false;
  }

  async handleWebhook(payload: PayloadWebhook) {
    this.logger.log(`Processando webhook: ${JSON.stringify(payload)}`);
    this.logger.log(`Tipo do evento: ${payload.type}`);
    this.logger.log(
      `Cliente: ${payload.data.customer.name} (${payload.data.customer.email})`,
    );
    this.logger.log(
      `Plano: ${payload.data.plan.description} (Valor: ${payload.data.plan.value})`,
    );
    this.logger.log(
      `Status da assinatura: ${payload.data.subscription.status}`,
    );

    const eventId = `${payload.type}-${payload.data.subscription.id}-${payload.data.customer.email}`;
    this.logger.log(`ID do evento: ${eventId}`);

    try {
      switch (payload.type.trim()) {
        case 'SIGNATURE-CREATED':
          this.logger.log(
            'Iniciando processo de criação de usuário após assinatura',
          );
          if (
            this.shouldSendEmail(
              payload.data.customer.email,
              'SIGNATURE-CREATED',
            )
          ) {
            await this.createUser(
              payload.data.customer.email,
              payload.data.customer.name,
              true,
            );
            this.logger.log(
              'Usuário criado com sucesso após SIGNATURE-CREATED',
            );
          } else {
            this.logger.log('Pulando criação duplicada de usuário');
          }
          break;

        case 'SIGNATURE-CANCELLED':
          this.logger.log(
            'Iniciando processo de desativação de usuário após cancelamento',
          );
          if (
            this.shouldSendEmail(
              payload.data.customer.email,
              'SIGNATURE-CANCELLED',
            )
          ) {
            await this.desactiveUser(
              payload.data.customer.email,
              payload.data.customer.name,
            );
            this.logger.log(
              'Usuário desativado com sucesso após SIGNATURE-CANCELLED',
            );
          } else {
            this.logger.log('Pulando desativação duplicada de usuário');
          }
          break;

        case 'SIGNATURE-INVOICE-CREATED':
          this.logger.log(
            'Iniciando processo de notificação para fatura criada',
          );
          if (
            this.shouldSendEmail(
              payload.data.customer.email,
              'SIGNATURE-INVOICE-CREATED',
            )
          ) {
            await this.notifyInvoiceCreated(
              payload.data.customer.email,
              payload.data.customer.name,
              payload.data.plan.description,
              payload.data.plan.value,
              payload.data.subscription.id,
            );
            this.logger.log('Notificação de fatura criada enviada com sucesso');
          } else {
            this.logger.log(
              'Pulando envio duplicado de notificação de fatura criada',
            );
          }
          break;

        case 'SIGNATURE-INVOICE-PAID':
          this.logger.log('Iniciando processo de notificação para fatura paga');
          if (
            this.shouldSendEmail(
              payload.data.customer.email,
              'SIGNATURE-INVOICE-PAID',
            )
          ) {
            await this.notifyInvoicePaid(
              payload.data.customer.email,
              payload.data.customer.name,
              payload.data.plan.description,
              payload.data.plan.value,
              payload.data.subscription.id,
            );
            this.logger.log('Notificação de fatura paga enviada com sucesso');
          } else {
            this.logger.log(
              'Pulando envio duplicado de notificação de fatura paga',
            );
          }
          break;

        case 'CHARGE-APPROVED':
          this.logger.log('Processando evento CHARGE-APPROVED');
          this.logger.log('Evento CHARGE-APPROVED processado com sucesso');
          break;

        default:
          this.logger.warn(`Evento não tratado: ${payload.type}`);
          this.logger.warn(
            `Payload completo do evento não tratado: ${JSON.stringify(payload)}`,
          );
          break;
      }

      return {
        success: true,
        message: 'Webhook processado com sucesso',
        webhookType: payload.type,
        eventId: eventId,
      };
    } catch (error) {
      this.logger.error(
        `Erro ao processar webhook ${payload.type}: ${error.message}`,
      );
      this.logger.error(`Stack trace: ${error.stack}`);
      this.logger.error(`Payload do erro: ${JSON.stringify(payload)}`);
      throw error;
    }
  }

  private async createUser(
    email: string,
    name: string,
    isAdmin: boolean = false,
  ): Promise<void> {
    const normalizedEmail = email.trim().toLowerCase();
    this.logger.log(
      `Tentando criar usuário: ${normalizedEmail} (Admin: ${isAdmin})`,
    );

    const existingUser = await this.prismaService.user.findFirst({
      where: { email: normalizedEmail },
    });

    if (existingUser) {
      this.logger.log(`Usuário já existe (${existingUser.id}).`);

      if (!existingUser.isActive) {
        this.logger.log(`Reativando usuário inativo: ${existingUser.id}`);
        await this.prismaService.user.update({
          where: { id: existingUser.id },
          data: { isActive: true },
        });

        if (this.shouldSendEmail(normalizedEmail, 'USER-REACTIVATED')) {
          await this.sendReactivationEmail(normalizedEmail, name);
        }
        return;
      }

      this.logger.log(`Usuário ativo. Enviando novas credenciais.`);
      const tempPassword = this.appService.generateRandomPassword(12);
      const hashedPassword =
        this.authService.generateHashPassword(tempPassword);
      await this.prismaService.user.update({
        where: { id: existingUser.id },
        data: { password: hashedPassword },
      });

      if (this.shouldSendEmail(normalizedEmail, 'USER-CREDENTIALS')) {
        await this.sendExistingUserCredentialsEmail(
          normalizedEmail,
          name,
          tempPassword,
        );
      }
      return;
    }

    const password = this.appService.generateRandomPassword(12);
    try {

      const result = await this.authService.createUser({
        email: normalizedEmail,
        name,
        cpf: this.buildSyntheticCpfFromInput(normalizedEmail),
        password,
        confirmPassword: password, 
        role: isAdmin ? Role.ADMIN : Role.USER, 
      });
      this.logger.log(`Usuário criado com sucesso: ${result.user.id}`);

      if (this.shouldSendEmail(normalizedEmail, 'USER-WELCOME')) {
        await this.sendWelcomeEmail(normalizedEmail, name, password);
      }
    } catch (error) {
      if (
        error.response === 'User with this email already exists' ||
        error.message.includes('already exists')
      ) {
        this.logger.warn(
          `Conflito ao criar usuário (${normalizedEmail}), presumindo usuário existente.`,
        );
        const tempPassword = this.appService.generateRandomPassword(12);
        const hashedPassword =
          this.authService.generateHashPassword(tempPassword);
        const existingUser = await this.prismaService.user.findFirst({
          where: { email: normalizedEmail },
        });
        
        if (existingUser) {
          await this.prismaService.user.update({
            where: { id: existingUser.id },
            data: { password: hashedPassword, isActive: true },
          });
        }

        if (this.shouldSendEmail(normalizedEmail, 'USER-CREDENTIALS')) {
          await this.sendExistingUserCredentialsEmail(
            normalizedEmail,
            name,
            tempPassword,
          );
        }
        return;
      }
      this.logger.error(
        `Falha inesperada ao criar usuário: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  private async desactiveUser(email: string, name: string): Promise<void> {
    this.logger.log(`Desativando usuário: ${email}`);

    try {
      const user = await this.prismaService.user.findFirst({
        where: { email: email.trim().toLowerCase() },
      });

      if (!user) {
        this.logger.warn(`Usuário não encontrado para desativação: ${email}`);
        throw new Error('Usuário não encontrado');
      }

      if (!user.isActive) {
        this.logger.log(
          `Usuário ${email} já está desativado. Nenhuma ação necessária.`,
        );
        return;
      }

      await this.prismaService.user.update({
        where: { id: user.id },
        data: { isActive: false },
      });

      this.logger.log(`Usuário desativado com sucesso: ${email}`);

      if (this.shouldSendEmail(email, 'USER-DEACTIVATED')) {
        await this.sendDeactivationEmail(email, name);
      }
    } catch (error) {
      this.logger.error(
        `Falha ao desativar usuário ${email}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  private async notifyInvoiceCreated(
    email: string,
    name: string,
    planDescription: string,
    planValue: number,
    subscriptionId: string,
  ): Promise<void> {
    this.logger.log(`Enviando notificação de fatura criada para: ${email}`);

    try {
      const user = await this.prismaService.user.findFirst({
        where: { email: email.trim().toLowerCase() },
      });

      if (!user) {
        this.logger.warn(
          `Usuário não encontrado para notificação de fatura: ${email}`,
        );
        this.logger.log(`Criando usuário automaticamente para ${email}`);

        // Cria o usuário se não existir
        await this.createUser(email, name, true);
      } else {
        this.logger.log(`Usuário encontrado: ${user.id}`);
      }

      const formattedValue = new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
      }).format(planValue);

      await this.appService.sendMail({
        to: email,
        subject: `Nova Fatura Criada - ${planDescription}`,
        html: `
          <h1>Nova Fatura Disponível</h1>
          <p>Olá ${name},</p>
          <p>Informamos que foi gerada uma nova fatura referente à sua assinatura:</p>
          <ul>
            <li><strong>Plano:</strong> ${planDescription}</li>
            <li><strong>Valor:</strong> ${formattedValue}</li>
            <li><strong>ID da Assinatura:</strong> ${subscriptionId}</li>
          </ul>
          <p>A fatura está disponível para pagamento. Por favor, acesse sua conta para efetuar o pagamento.</p>
          <p>Caso já tenha efetuado o pagamento, por favor desconsidere este e-mail.</p>
          <p>Acesse: ${process.env.FRONTEND_URL || 'https://seusite.com'}</p>
          
          <hr>
          <p>Data e hora do envio: ${new Date().toLocaleString('pt-BR')}</p>
        `,
      });

      this.logger.log(
        `E-mail de notificação de fatura criada enviado com sucesso para ${email}`,
      );
    } catch (error) {
      this.logger.error(
        `Falha ao enviar notificação de fatura criada para ${email}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  private async notifyInvoicePaid(
    email: string,
    name: string,
    planDescription: string,
    planValue: number,
    subscriptionId: string,
  ): Promise<void> {
    this.logger.log(`Enviando notificação de fatura paga para: ${email}`);

    try {
      const user = await this.prismaService.user.findFirst({
        where: { email: email.trim().toLowerCase() },
      });

      if (!user) {
        this.logger.warn(
          `Usuário não encontrado para notificação de pagamento: ${email}`,
        );
        this.logger.log(`Criando usuário automaticamente para ${email}`);

        // Cria o usuário se não existir
        await this.createUser(email, name, true);
        // Após criar, buscar novamente
        return await this.notifyInvoicePaid(email, name, planDescription, planValue, subscriptionId);
      } else if (!user.isActive) {
        this.logger.log(`Reativando usuário após pagamento: ${user.id}`);
        await this.prismaService.user.update({
          where: { id: user.id },
          data: { isActive: true },
        });
      }

      // --- LIBERAÇÃO DO EBOOK ---
      // Tenta encontrar o livro pelo título (planDescription)
      const book = await this.prismaService.book.findFirst({
        where: { title: planDescription },
      });
      if (book) {
        // Cria Order se não existir para este pagamento
        let order = await this.prismaService.order.findFirst({
          where: {
            userId: user.id,
            status: 'paid',
            orderItems: { some: { bookId: book.id } },
          },
        });
        if (!order) {
          order = await this.prismaService.order.create({
            data: {
              userId: user.id,
              orderNumber: `DOM-${Date.now()}`,
              status: 'paid',
              totalAmount: book.price,
              subtotal: book.price,
              tax: 0,
              discount: 0,
              paymentMethod: 'dom',
              paymentStatus: 'paid',
              store: 'ebook', // DOM sempre vem do ebook
              notes: `Pagamento DOM: ${subscriptionId}`,
              orderItems: {
                create: [{
                  bookId: book.id,
                  quantity: 1,
                  unitPrice: book.price,
                  totalPrice: book.price,
                }],
              },
            },
            include: { orderItems: true },
          });
          this.logger.log(`Order criada e ebook liberado para o usuário: ${user.email} - Livro: ${book.title}`);
          
          // ✅ NOVO: Atualizar contador de vendas do livro
          await this.updateBookSalesCount(book.id, 1);
        } else {
          this.logger.log(`Order já existente para este usuário e livro: ${user.email} - ${book.title}`);
        }
      } else {
        this.logger.warn(`Livro não encontrado para liberação: ${planDescription}`);
      }
      // --- FIM DA LIBERAÇÃO DO EBOOK ---

      const formattedValue = new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
      }).format(planValue);

      const paymentDate = new Date().toLocaleDateString('pt-BR');

      await this.appService.sendMail({
        to: email,
        subject: `Pagamento Confirmado - ${planDescription}`,
        html: `
          <h1>Pagamento Confirmado</h1>
          <p>Olá ${name},</p>
          <p>Confirmamos o recebimento do pagamento da sua fatura:</p>
          <ul>
            <li><strong>Plano:</strong> ${planDescription}</li>
            <li><strong>Valor:</strong> ${formattedValue}</li>
            <li><strong>Data do Pagamento:</strong> ${paymentDate}</li>
            <li><strong>ID da Assinatura:</strong> ${subscriptionId}</li>
          </ul>
          <p>Agradecemos a confiança em nossos serviços!</p>
          <p>Acesse: ${process.env.FRONTEND_URL || 'https://seusite.com'}</p>
          
          <hr>
          <p>Data e hora do envio: ${new Date().toLocaleString('pt-BR')}</p>
        `,
      });

      this.logger.log(
        `E-mail de confirmação de pagamento enviado com sucesso para ${email}`,
      );
    } catch (error) {
      this.logger.error(
        `Falha ao enviar notificação de pagamento para ${email}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Atualiza o contador de vendas de um livro
   */
  private async updateBookSalesCount(bookId: number, quantity: number): Promise<void> {
    try {
      // Buscar o livro atual
      const book = await this.prismaService.book.findUnique({
        where: { id: bookId },
        select: { sales: true }
      });

      if (!book) {
        this.logger.warn(`⚠️ Livro ${bookId} não encontrado para atualizar vendas`);
        return;
      }

      // Calcular novo total de vendas
      const newSalesCount = (book.sales || 0) + quantity;

      // Atualizar o campo sales do livro
      await this.prismaService.book.update({
        where: { id: bookId },
        data: { sales: newSalesCount }
      });

      this.logger.log(`✅ Vendas do livro ${bookId} atualizadas: ${book.sales || 0} → ${newSalesCount} (+${quantity})`);
    } catch (error) {
      this.logger.error(`❌ Erro ao atualizar vendas do livro ${bookId}:`, error);
      // Não vamos lançar o erro para não interromper o fluxo principal
    }
  }

  private async sendWelcomeEmail(
    email: string,
    name: string,
    password: string,
  ): Promise<void> {
    try {
      this.logger.log(`Enviando e-mail de boas-vindas para ${email}`);

      await this.appService.sendMail({
        to: email,
        subject:
          'Suas credenciais de acesso como Administrador - ' +
          new Date().toLocaleString('pt-BR'),
        html: `
          <h1>Credenciais de Acesso ao Sistema</h1>
          <p>Olá ${name},</p>
          <p>Uma conta de administrador foi criada para você em nosso sistema. Abaixo estão suas credenciais de acesso:</p>
          <p><strong>Email:</strong> ${email}</p>
          <p><strong>Nome de usuário:</strong> ${name}</p>
          <p><strong>Senha:</strong> ${password}</p>
          <p>Acesse: ${process.env.FRONTEND_URL || 'https://areademembros.simintermediacoes.com'}</p>
          
          <hr>
          <h2>Informações de teste do sistema de email</h2>
          <p>Este email também serve como confirmação de que as configurações SMTP estão funcionando corretamente.</p>
          <p>Data e hora do envio: ${new Date().toLocaleString('pt-BR')}</p>
        `,
      });

      this.logger.log(
        `E-mail de boas-vindas enviado com sucesso para ${email}`,
      );
    } catch (error) {
      this.logger.error(
        `Falha ao enviar email de boas-vindas para ${email}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  private async sendDeactivationEmail(
    email: string,
    name: string,
  ): Promise<void> {
    try {
      this.logger.log(`Enviando e-mail de desativação para ${email}`);

      await this.appService.sendMail({
        to: email,
        subject: 'Sua Conta Foi Desativada',
        html: `
          <h1>Aviso de Desativação de Conta</h1>
          <p>Olá ${name},</p>
          <p>Lamentamos informar que sua assinatura foi cancelada e sua conta foi desativada.</p>
          <p>Se isso não foi intencional, entre em contato com nossa equipe de suporte para reativar sua assinatura.</p>
          <p>Agradecemos por ter utilizado nossos serviços.</p>
          
          <hr>
          <p>Data e hora do envio: ${new Date().toLocaleString('pt-BR')}</p>
        `,
      });

      this.logger.log(
        `E-mail de desativação enviado com sucesso para ${email}`,
      );
    } catch (error) {
      this.logger.error(
        `Falha ao enviar email de desativação para ${email}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  private async sendReactivationEmail(
    email: string,
    name: string,
  ): Promise<void> {
    try {
      this.logger.log(`Enviando e-mail de reativação para ${email}`);

      await this.appService.sendMail({
        to: email,
        subject: 'Sua Conta Foi Reativada',
        html: `
          <h1>Aviso de Reativação de Conta</h1>
          <p>Olá ${name},</p>
          <p>Estamos felizes em informar que sua conta foi reativada com sucesso!</p>
          <p>Você já pode acessar novamente todos os recursos da plataforma.</p>
          <p>Acesse: ${process.env.FRONTEND_URL || 'https://seusite.com'}</p>
          
          <hr>
          <p>Data e hora do envio: ${new Date().toLocaleString('pt-BR')}</p>
        `,
      });

      this.logger.log(`E-mail de reativação enviado com sucesso para ${email}`);
    } catch (error) {
      this.logger.error(
        `Falha ao enviar email de reativação para ${email}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  private async sendExistingUserCredentialsEmail(
    email: string,
    name: string,
    password: string,
  ): Promise<void> {
    try {
      this.logger.log(
        `Enviando e-mail de credenciais para usuário existente: ${email}`,
      );

      await this.appService.sendMail({
        to: email,
        subject:
          'Suas credenciais de acesso atualizadas - ' +
          new Date().toLocaleString('pt-BR'),
        html: `
          <h1>Credenciais de Acesso ao Sistema</h1>
          <p>Olá ${name},</p>
          <p>Identificamos que você já possui uma conta em nosso sistema e está realizando uma nova assinatura. 
          Suas credenciais de acesso foram atualizadas:</p>
          <p><strong>Email:</strong> ${email}</p>
          <p><strong>Nome de usuário:</strong> ${name}</p>
          <p><strong>Senha:</strong> ${password}</p>
          <p>Acesse: ${process.env.FRONTEND_URL || 'https://areademembros.simintermediacoes.com'}</p>
          
          <hr>
          <p>Data e hora do envio: ${new Date().toLocaleString('pt-BR')}</p>
        `,
      });

      this.logger.log(
        `E-mail de credenciais enviado com sucesso para usuário existente ${email}`,
      );
    } catch (error) {
      this.logger.error(
        `Falha ao enviar email de credenciais para usuário existente ${email}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  async testWebhookWithSignatureCreated() {
    this.logger.log('Iniciando teste do webhook SIGNATURE-CREATED');

    const payload = {
      type: 'SIGNATURE-CREATED',
      data: {
        customer: {
          dom_customer_id: 'eeacab24-81a2-453c-85b9-68a2364f9045',
          email: 'gabrielpg.at@gmail.com',
          name: 'Breno Henrique de Souza Lima',
        },
        subscription: {
          id: '15c35216-afa2-4ee0-905a-bb39e3976430',
          status: 'ACTIVE',
          external_reference:
            'd8d7c125-016c-4005-90db-dd766252f60c:64bbe6ea-a378-4378-9cb9-3a1bd65b6171',
        },
        plan: {
          id: '46de3445-2d4a-4aa6-9068-dbca18d931ec',
          dom_plan_id: '534d730b-83d0-4930-b956-4c4c3b93a3f7',
          value: 1,
          description: 'Plano de Teste',
          external_reference:
            'a5fcd56b-dc1c-48a3-9529-1e50bd052c9d:292b1905-c922-460d-b4d2-00aa607a1d1a',
        },
      },
    };
    this.logger.log(`Payload de teste: ${JSON.stringify(payload)}`);

    try {
      await this.handleWebhook(payload);

      this.logger.log('Webhook de teste processado com sucesso!');
      this.logger.log(
        `Usuário criado e email enviado para: ${payload.data.customer.email}`,
      );

      return {
        success: true,
        message: 'Webhook processado com sucesso',
        userEmail: payload.data.customer.email,
        userName: payload.data.customer.name,
        webhookType: payload.type,
      };
    } catch (error) {
      this.logger.error(
        `Erro ao processar webhook de teste: ${error.message}`,
        error.stack,
      );

      return {
        success: false,
        message: 'Falha ao processar webhook de teste',
        error: error.message,
        stack: process.env.NODE_ENV === 'production' ? undefined : error.stack,
      };
    }
  }

  async testWebhookWithInvoiceCreated() {
    this.logger.log('Iniciando teste do webhook SIGNATURE-INVOICE-CREATED');

    const payload = {
      type: 'SIGNATURE-INVOICE-CREATED',
      data: {
        customer: {
          id: '7db67756-19f7-472a-88fd-99d993d4d14c',
          name: 'Breno Henrique de Souza Lima',
          email: 'gabrielpg.at@gmail.com',
        },
        plan: {
          id: 'a8607237-4ea8-495d-a710-b90ca5469f1f',
          value: 1,
          description: 'Plano Mensal',
          external_reference:
            '034d93d6-104e-48e2-a807-6ba828742606:7db67756-19f7-472a-88fd-99d993d4d14c',
        },
        subscription: {
          id: 'bcf00be2-d95f-4f6b-a41a-033d26f81df1',
          status: 'active',
          external_reference:
            '034d93d6-104e-48e2-a807-6ba828742606:7db67756-19f7-472a-88fd-99d993d4d14c',
        },
      },
    };
    this.logger.log(
      `Payload de teste para fatura criada: ${JSON.stringify(payload)}`,
    );

    try {
      await this.handleWebhook(payload);

      this.logger.log(
        'Webhook de teste de fatura criada processado com sucesso!',
      );
      this.logger.log(
        `Email de notificação enviado para: ${payload.data.customer.email}`,
      );

      return {
        success: true,
        message: 'Webhook de fatura criada processado com sucesso',
        userEmail: payload.data.customer.email,
        userName: payload.data.customer.name,
        webhookType: payload.type,
      };
    } catch (error) {
      this.logger.error(
        `Erro ao processar webhook de teste de fatura criada: ${error.message}`,
        error.stack,
      );

      return {
        success: false,
        message: 'Falha ao processar webhook de teste de fatura criada',
        error: error.message,
        stack: process.env.NODE_ENV === 'production' ? undefined : error.stack,
      };
    }
  }

  async testWebhookWithInvoicePaid() {
    this.logger.log('Iniciando teste do webhook SIGNATURE-INVOICE-PAID');

    const payload = {
      type: 'SIGNATURE-INVOICE-PAID',
      data: {
        customer: {
          id: '7db67756-19f7-472a-88fd-99d993d4d14c',
          name: 'Breno Henrique de Souza Lima',
          email: 'gabrielpg.at@gmail.com',
        },
        plan: {
          id: 'a8607237-4ea8-495d-a710-b90ca5469f1f',
          value: 1,
          description: 'Plano Mensal',
          external_reference:
            '034d93d6-104e-48e2-a807-6ba828742606:7db67756-19f7-472a-88fd-99d993d4d14c',
        },
        subscription: {
          id: 'bcf00be2-d95f-4f6b-a41a-033d26f81df1',
          status: 'active',
          external_reference:
            '034d93d6-104e-48e2-a807-6ba828742606:7db67756-19f7-472a-88fd-99d993d4d14c',
        },
      },
    };
    this.logger.log(
      `Payload de teste para fatura paga: ${JSON.stringify(payload)}`,
    );

    try {
      await this.handleWebhook(payload);

      this.logger.log(
        'Webhook de teste de fatura paga processado com sucesso!',
      );
      this.logger.log(
        `Email de confirmação enviado para: ${payload.data.customer.email}`,
      );

      return {
        success: true,
        message: 'Webhook de fatura paga processado com sucesso',
        userEmail: payload.data.customer.email,
        userName: payload.data.customer.name,
        webhookType: payload.type,
      };
    } catch (error) {
      this.logger.error(
        `Erro ao processar webhook de teste de fatura paga: ${error.message}`,
        error.stack,
      );

      return {
        success: false,
        message: 'Falha ao processar webhook de teste de fatura paga',
        error: error.message,
        stack: process.env.NODE_ENV === 'production' ? undefined : error.stack,
      };
    }
  }
}
