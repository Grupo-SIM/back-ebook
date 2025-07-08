import { Injectable } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import * as crypto from 'crypto';
import { Role, UserRole } from './types/interfaces/role';

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  from?: string;
}

@Injectable()
export class AppService {
  private transporter: nodemailer.Transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: 'simintermediacoes.com',
      port: 465,
      secure: true,
      auth: {
        user: 'noreply@simintermediacoes.com',
        pass: 'p4nkZXkQ5yeiZPM',
      },
      tls: {
        rejectUnauthorized: false,
      },
    });
  }

  generateRandomPassword(length = 10): string {
    const charset =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_-+=';
    let password = '';

    password += 'A' + 'a' + '1' + '!';

    for (let i = 4; i < length; i++) {
      const randomIndex = crypto.randomInt(0, charset.length);
      password += charset[randomIndex];
    }

    return password
      .split('')
      .sort(() => 0.5 - Math.random())
      .join('');
  }

  async sendMail(options: EmailOptions): Promise<void> {
    const { to, subject, html } = options;

    const mailOptions = {
      from: 'noreply@simintermediacoes.com',
      to,
      subject,
      html,
    };

    try {
      await this.transporter.sendMail(mailOptions);
    } catch (error) {
      console.error('Erro ao enviar email:', error);
      throw new Error(`Falha ao enviar email: ${error.message}`);
    }
  }

  getHello(): string {
    return 'Hello World!';
  }

  async testEmailService(email: string, name: string): Promise<any> {
    try {
      await this.sendMail({
        to: email,
        subject: 'Teste de Configuração de Email',
        html: `
          <h1>Teste de Email</h1>
          <p>Olá ${name},</p>
          <p>Este é um email de teste para verificar se as configurações SMTP estão funcionando corretamente.</p>
          <p>Se você recebeu este email, significa que o serviço está configurado corretamente.</p>
          <p>Data e hora do envio: ${new Date().toLocaleString('pt-BR')}</p>
        `,
      });
      return { success: true, message: 'Email de teste enviado com sucesso' };
    } catch (error) {
      console.error('Erro ao enviar email de teste:', error);
      return {
        success: false,
        message: 'Falha ao enviar email de teste',
        error: error.message,
        stack: error.stack,
      };
    }
  }

  prepareUserData(email: string) {
    const name = email.split('@')[0];
    const password = this.generateRandomPassword(12);

    return {
      email,
      name,
      password,
      role: Role.ADMIN,
    };
  }

  async sendCredentialsMail(
    email: string,
    name: string,
    password: string,
  ): Promise<void> {
    await this.sendMail({
      to: email,
      subject: 'Suas Credenciais de Acesso como Administrador',
      html: `
        <h1>Bem-vindo ao Sistema</h1>
        <p>Olá ${name},</p>
        <p>Uma conta de administrador foi criada para você em nosso sistema. Abaixo estão suas credenciais de acesso:</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Senha:</strong> ${password}</p>
        <p>Acesse: ${process.env.FRONTEND_URL || 'https://areademembros.simintermediacoes.com'}</p>
        <p>Atenciosamente,<br>Equipe de Suporte</p>
      `,
    });
  }
}
