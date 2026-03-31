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
    // Configuração SMTP original
    const smtpConfig = {
      host: process.env.SMTP_HOST || 'simintermediacoes.com',
      port: parseInt(process.env.SMTP_PORT) || 465,

      secure: process.env.SMTP_SECURE === 'true', 
      auth: {
        user: process.env.SMTP_USER || 'noreply@simintermediacoes.com',
        pass: process.env.SMTP_PASSWORD || 'p4nkZXkQ5yeiZPM',
      },
      tls: {
        rejectUnauthorized: false,
      },
    };

    console.log('📧 Configuração SMTP:', {
      host: smtpConfig.host,
      port: smtpConfig.port,
      secure: smtpConfig.secure,
      user: smtpConfig.auth.user,
      // Não logar a senha por segurança
    });

    this.transporter = nodemailer.createTransport(smtpConfig);

    // Verificar conexão SMTP na inicialização
    this.verifySMTPConnection();
  }

  private async verifySMTPConnection() {
    try {
      await this.transporter.verify();
      console.log('✅ Conexão SMTP verificada com sucesso');
    } catch (error) {
      console.error('❌ Erro na verificação da conexão SMTP:', error);
    }
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
      from: process.env.SMTP_FROM_EMAIL || 'noreply@simintermediacoes.com',
      to,
      subject,
      html,
    };

    console.log(`📧 Tentando enviar email para: ${to}`);
    console.log(`📧 Assunto: ${subject}`);
    console.log(`📧 De: ${mailOptions.from}`);

    try {
      const result = await this.transporter.sendMail(mailOptions);
      console.log(`✅ Email enviado com sucesso para ${to}`);
      console.log(`📧 Message ID: ${result.messageId}`);
      console.log(`📧 Resposta do servidor:`, result.response);
    } catch (error) {
      console.error('❌ Erro ao enviar email:', {
        error: error.message,
        code: error.code,
        command: error.command,
        response: error.response,
        responseCode: error.responseCode,
        stack: error.stack
      });
      
      // Tentar novamente uma vez em caso de erro temporário
      if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.code === 'ECONNREFUSED') {
        console.log('🔄 Tentando reenviar email após erro de conexão...');
        try {
          await new Promise(resolve => setTimeout(resolve, 2000)); // Esperar 2 segundos
          const retryResult = await this.transporter.sendMail(mailOptions);
          console.log(`✅ Email reenviado com sucesso para ${to}`);
          console.log(`📧 Message ID: ${retryResult.messageId}`);
          return;
        } catch (retryError) {
          console.error('❌ Falha no reenvio do email:', retryError.message);
        }
      }
      
      throw new Error(`Falha ao enviar email: ${error.message}`);
    }
  }

  getHello(): string {
    return 'Hello World!';
  }

  async testEmailService(email: string, name: string): Promise<any> {
    try {
      console.log('🧪 Iniciando teste de serviço de email...');
      console.log('📧 Configuração SMTP atual:', {
        host: process.env.SMTP_HOST || 'simintermediacoes.com',
        port: process.env.SMTP_PORT || '465',
        secure: process.env.SMTP_SECURE || 'true',
        user: process.env.SMTP_USER || 'noreply@simintermediacoes.com',
        from: process.env.SMTP_FROM_EMAIL || 'noreply@simintermediacoes.com'
      });

      // Verificar conexão SMTP antes do teste
      try {
        await this.transporter.verify();
        console.log('✅ Conexão SMTP verificada antes do teste');
      } catch (verifyError) {
        console.error('❌ Falha na verificação SMTP:', verifyError.message);
        return {
          success: false,
          message: 'Falha na verificação da conexão SMTP',
          error: verifyError.message,
          smtpConfig: {
            host: process.env.SMTP_HOST || 'simintermediacoes.com',
            port: process.env.SMTP_PORT || '465',
            secure: process.env.SMTP_SECURE || 'true',
            user: process.env.SMTP_USER || 'noreply@simintermediacoes.com'
          }
        };
      }

      await this.sendMail({
        to: email,
        subject: 'Teste de Configuração de Email - EbookSIM',
        html: `
          <!DOCTYPE html>
          <html lang="pt-BR">
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Teste de Email - EbookSIM</title>
            <style>
              body { font-family: Arial, sans-serif; margin: 20px; }
              .success { color: #22c55e; font-weight: bold; }
              .info { background: #f3f4f6; padding: 15px; border-radius: 8px; margin: 15px 0; }
            </style>
          </head>
          <body>
            <h1>🧪 Teste de Configuração de Email</h1>
            <p>Olá <strong>${name}</strong>,</p>
            <p class="success">✅ Este é um email de teste para verificar se as configurações SMTP estão funcionando corretamente.</p>
            
            <div class="info">
              <h3>📋 Informações do Teste:</h3>
              <p><strong>Data e hora:</strong> ${new Date().toLocaleString('pt-BR')}</p>
              <p><strong>Servidor SMTP:</strong> ${process.env.SMTP_HOST || 'simintermediacoes.com'}</p>
              <p><strong>Porta:</strong> ${process.env.SMTP_PORT || '465'}</p>
              <p><strong>Seguro:</strong> ${process.env.SMTP_SECURE || 'true'}</p>
            </div>
            
            <p>Se você recebeu este email, significa que o serviço está configurado corretamente.</p>
            <p><strong>Status:</strong> <span class="success">FUNCIONANDO</span></p>
          </body>
          </html>
        `,
      });
      
      return { 
        success: true, 
        message: 'Email de teste enviado com sucesso',
        timestamp: new Date().toISOString(),
        smtpConfig: {
          host: process.env.SMTP_HOST || 'simintermediacoes.com',
          port: process.env.SMTP_PORT || '465',
          secure: process.env.SMTP_SECURE || 'true',
          user: process.env.SMTP_USER || 'noreply@simintermediacoes.com'
        }
      };
    } catch (error) {
      console.error('❌ Erro ao enviar email de teste:', error);
      return {
        success: false,
        message: 'Falha ao enviar email de teste',
        error: error.message,
        timestamp: new Date().toISOString(),
        smtpConfig: {
          host: process.env.SMTP_HOST || 'simintermediacoes.com',
          port: process.env.SMTP_PORT || '465',
          secure: process.env.SMTP_SECURE || 'true',
          user: process.env.SMTP_USER || 'noreply@simintermediacoes.com'
        }
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
