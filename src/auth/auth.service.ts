import * as bcrypt from 'bcrypt';
import { PrismaService } from 'prisma/prisma.service';
import { AppService } from 'src/app.service';
import {
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  AuthOutputDTO,
  CreateUserInputDTO,
  LoginInputDTO,
  PayloadAuth,
  UpdatePasswordInputDTO,
  UpdateRecoveryPasswordInputDTO,
} from './dto/auth.dto';
import { Role } from 'src/types/interfaces/role';

@Injectable()
export class AuthService {
  constructor(
    private jwtService: JwtService,
    private prismaService: PrismaService,
    private appService: AppService,
  ) { }

  public generateHashPassword(password: string) {
    const salt = bcrypt.genSaltSync(9);
    const hash = bcrypt.hashSync(password, salt);
    return hash;
  }

  async validateUser(
    data: LoginInputDTO,
    ip: string,
    userAgent: string,
    expectedRole: 'USER' | 'ADMIN' | 'CUSTOMER',
  ): Promise<AuthOutputDTO> {
    const user = await this.prismaService.user.findUnique({
      where: {
        email: String(data.email).toLowerCase().trim(),
      },
      include: {
        admin: true,
        createdBy: true,
      }
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.role.toString() !== expectedRole) {
      throw new ConflictException(`User is not a ${expectedRole}`);
    }

    const validPassword = bcrypt.compareSync(data.password, user.password);

    if (!validPassword) {
      throw new ConflictException('Invalid password');
    }

    if (!user.isActive) {
      throw new ConflictException('User is inactive.');
    }

    const payload: PayloadAuth = {
      id: user.id,
      name: user.name || '',
      role: user.role.toString(),
      email: user.email,
      createdById: user.createdById,
    };

    const access_token = await this.login(payload);

    const userResponse = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role.toString(),
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      isActive: user.isActive,
      createdById: user.createdById,
      admin: user.admin
    };

    return {
      token: access_token,
      user: userResponse,
    };
  }

  async login(payload: PayloadAuth): Promise<string> {
    const access_token = this.jwtService.sign(payload);
    return access_token;
  }

  async passwordRecoveryLink(email: string) {
    try {
      const user = await this.prismaService.user.findUnique({
        where: {
          email: email.toLowerCase().trim(),
        },
      });

      if (!user) {
        throw new NotFoundException('Usuário não encontrado');
      }

      if (!user.isActive) {
        throw new ConflictException('Usuário inativo');
      }

      // Gerar nova senha aleatória
      const newPassword = this.appService.generateRandomPassword(12);
      const hashedPassword = this.generateHashPassword(newPassword);

      // Atualizar a senha no banco
      await this.prismaService.user.update({
        where: { id: user.id },
        data: { password: hashedPassword },
      });

      // Enviar email com a nova senha
      try {
        await this.appService.sendMail({
          to: user.email,
          subject: 'Nova senha gerada - EbookSIM',
          html: `
            <!DOCTYPE html>
            <html lang="pt-BR">
            <head>
              <meta charset="UTF-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <title>Nova Senha - EbookSIM</title>
              <style>
                * {
                  margin: 0;
                  padding: 0;
                  box-sizing: border-box;
                }
                
                body {
                  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
                  background: linear-gradient(135deg, #0f0f0f 0%, #1a1a1a 100%);
                  color: #ffffff;
                  line-height: 1.6;
                }
                
                .container {
                  max-width: 600px;
                  margin: 0 auto;
                  padding: 40px 20px;
                }
                
                .header {
                  text-align: center;
                  margin-bottom: 40px;
                }
                
                .logo {
                  font-size: 32px;
                  font-weight: 700;
                  color: #ffffff;
                  margin-bottom: 8px;
                  letter-spacing: -0.5px;
                }
                
                .subtitle {
                  color: #a1a1aa;
                  font-size: 16px;
                  font-weight: 400;
                }
                
                .card {
                  background: #1f1f1f;
                  border: 1px solid #2a2a2a;
                  border-radius: 12px;
                  padding: 32px;
                  margin-bottom: 24px;
                  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
                }
                
                .title {
                  font-size: 28px;
                  font-weight: 700;
                  color: #ffffff;
                  margin-bottom: 16px;
                  text-align: center;
                }
                
                .text {
                  color: #d4d4d8;
                  font-size: 16px;
                  margin-bottom: 24px;
                  text-align: center;
                }
                
                .password-box {
                  background: #2a2a2a;
                  border: 2px solid #22c55e;
                  border-radius: 8px;
                  padding: 20px;
                  margin: 24px 0;
                  text-align: center;
                }
                
                .password-label {
                  color: #a1a1aa;
                  font-size: 14px;
                  font-weight: 500;
                  text-transform: uppercase;
                  letter-spacing: 0.5px;
                  margin-bottom: 8px;
                }
                
                .password-value {
                  color: #22c55e;
                  font-size: 18px;
                  font-weight: 700;
                  font-family: 'Courier New', monospace;
                  letter-spacing: 2px;
                  background: #1a1a1a;
                  padding: 12px 16px;
                  border-radius: 6px;
                  display: inline-block;
                  margin-top: 8px;
                }
                
                .warning {
                  background: #dc2626;
                  color: #ffffff;
                  padding: 16px;
                  border-radius: 8px;
                  margin: 24px 0;
                  text-align: center;
                  font-weight: 600;
                }
                
                .cta-button {
                  display: inline-block;
                  background: #22c55e;
                  color: #000000;
                  text-decoration: none;
                  padding: 12px 24px;
                  border-radius: 8px;
                  font-weight: 600;
                  font-size: 14px;
                  text-align: center;
                  margin: 24px 0;
                  transition: all 0.2s ease;
                }
                
                .cta-button:hover {
                  background: #16a34a;
                  transform: translateY(-1px);
                }
                
                .footer {
                  text-align: center;
                  margin-top: 40px;
                  padding-top: 24px;
                  border-top: 1px solid #2a2a2a;
                }
                
                .footer-text {
                  color: #71717a;
                  font-size: 12px;
                  line-height: 1.5;
                }
                
                .badge {
                  display: inline-block;
                  background: #dc2626;
                  color: #ffffff;
                  padding: 4px 8px;
                  border-radius: 4px;
                  font-size: 11px;
                  font-weight: 600;
                  text-transform: uppercase;
                  letter-spacing: 0.5px;
                }
                
                @media (max-width: 600px) {
                  .container {
                    padding: 20px 16px;
                  }
                  
                  .card {
                    padding: 24px;
                  }
                  
                  .title {
                    font-size: 24px;
                  }
                }
              </style>
            </head>
            <body>
              <div class="container">
                <div class="header">
                  <div class="logo">EbookSIM</div>
                  <div class="subtitle">Sua biblioteca digital</div>
                </div>
                
                <div class="card">
                  <div class="badge">Nova Senha</div>
                  <h1 class="title">🔐 Nova senha gerada</h1>
                  <p class="text">
                    Olá <strong>${user.name}</strong>, uma nova senha foi gerada para sua conta.
                  </p>
                  
                  <div class="password-box">
                    <div class="password-label">Sua nova senha</div>
                    <div class="password-value">${newPassword}</div>
                  </div>
                  
                  <div class="warning">
                    ⚠️ Guarde esta senha em um local seguro e altere-a após fazer login!
                  </div>
                  
                  <p class="text">
                    Use esta senha para fazer login na sua conta. Recomendamos que você altere esta senha 
                    para uma de sua preferência após fazer login.
                  </p>
                  
                  <div style="text-align: center;">
                    <a href="${process.env.FRONTEND_URL || 'https://ebooksim.com'}" class="cta-button">
                      🚀 Fazer Login
                    </a>
                  </div>
                </div>
                
                <div class="footer">
                  <p class="footer-text">
                    Se você não solicitou esta alteração, entre em contato conosco imediatamente.<br>
                    Este email foi enviado automaticamente. Por favor, não responda a este email.
                  </p>
                </div>
              </div>
            </body>
            </html>
          `,
        });
      } catch (emailError) {
        console.error('Erro ao enviar email de nova senha:', emailError);
        // Se o email falhar, reverter a mudança de senha
        await this.prismaService.user.update({
          where: { id: user.id },
          data: { password: user.password }, // Restaurar senha original
        });
        throw new InternalServerErrorException('Erro ao enviar email. Tente novamente.');
      }

      return {
        message: 'Nova senha enviada para o email',
        email: user.email
      };
    } catch (error) {
      console.error('Erro em passwordRecoveryLink:', error);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException('Erro ao processar recuperação de senha.');
    }
  }

  async resetPassword(token: string, data: UpdateRecoveryPasswordInputDTO) {
    try {
      // Validar se as senhas coincidem
      if (data.password !== data.confirmPassword) {
        throw new ConflictException('As senhas não coincidem');
      }

      // Verificar o token
      const payload = this.jwtService.verify(token);

      const user = await this.prismaService.user.findUnique({
        where: { id: payload.id },
      });

      if (!user) {
        throw new NotFoundException('User not found');
      }

      if (!user.isActive) {
        throw new ConflictException('User inactive');
      }

      // Atualizar a senha
      const newHashedPassword = this.generateHashPassword(data.password);

      await this.prismaService.user.update({
        where: { id: user.id },
        data: { password: newHashedPassword },
      });

      return { message: 'Password reset successfully' };
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        throw new ConflictException('Recovery token has expired');
      }
      if (error.name === 'JsonWebTokenError') {
        throw new ConflictException('Invalid recovery token');
      }
      throw error;
    }
  }

  async updatePassword(
    userId: string,
    data: UpdatePasswordInputDTO,
  ): Promise<void> {
    if (data.password !== data.confirmPassword) {
      throw new ConflictException('As senhas não coincidem');
    }

    const user = await this.prismaService.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const isOldPasswordValid = bcrypt.compareSync(
      data.oldPassword,
      user.password,
    );
    if (!isOldPasswordValid) {
      throw new ConflictException('Invalid old password');
    }

    const newHashedPassword = this.generateHashPassword(data.password);

    await this.prismaService.user.update({
      where: { id: userId },
      data: { password: newHashedPassword },
    });
  }

  async createUser(data: CreateUserInputDTO, creatorUserId?: string): Promise<AuthOutputDTO> {
    // Verificar se o usuário já existe
    const existingUser = await this.prismaService.user.findUnique({
      where: { email: data.email.toLowerCase() },
    });

    if (existingUser) {
      throw new ConflictException('User already exists');
    }

    // Gerar hash da senha
    const hashedPassword = this.generateHashPassword(data.password);

    // Criar usuário no sistema local
    const user = await this.prismaService.user.create({
      data: {
        email: data.email.toLowerCase(),
        name: data.name,
        password: hashedPassword,
        role: data.role || 'USER',
        createdById: creatorUserId,
      },
      include: {
        admin: true,
        createdBy: true,
      },
    });

    // NOVA FUNCIONALIDADE: Sincronizar com a API DOM
    try {
      await this.syncUserWithApiDom(user, data.password);
    } catch (error) {
      console.error('Erro ao sincronizar com API DOM:', error);
      // Não falhar o registro se a sincronização falhar
    }

    const payload: PayloadAuth = {
      id: user.id,
      name: user.name || '',
      role: user.role.toString(),
      email: user.email,
      createdById: user.createdById,
    };

    const access_token = await this.login(payload);

    const userResponse = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role.toString(),
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      isActive: user.isActive,
      createdById: user.createdById,
      admin: user.admin,
    };

    return {
      token: access_token,
      user: userResponse,
    };
  }

  // NOVA FUNCIONALIDADE: Sincronizar usuário com API DOM
  async syncUserWithApiDom(user: any, plainPassword: string): Promise<void> {
    try {
      console.log(`Iniciando sincronização para usuário: ${user.email} (${user.role})`);
      console.log(`Dados enviados: name=${user.name}, email=${user.email}, password=${plainPassword ? '***' : 'NULL'}`);

      // Validar dados antes de enviar
      if (!user.email || !plainPassword || !user.name) {
        console.error('Dados inválidos para sincronização:', { email: user.email, name: user.name, hasPassword: !!plainPassword });
        throw new Error('Dados inválidos para sincronização');
      }

      // 1. Registrar usuário na API DOM
      const registerPayload = {
        name: user.name,
        email: user.email,
        password: plainPassword,
      };

      console.log('Payload de registro:', { ...registerPayload, password: '***' });

      const registerResponse = await fetch('https://api-dom.jbmidia.com/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'EbookBackend/1.0',
        },
        body: JSON.stringify(registerPayload),
      });

      let registerData;
      if (registerResponse.ok) {
        registerData = await registerResponse.json();
        console.log('Usuário registrado na API DOM:', registerData);
      } else {
        const errorText = await registerResponse.text();
        console.log(`Erro no registro (${registerResponse.status}):`, errorText);
        console.log('Headers da resposta:', Object.fromEntries(registerResponse.headers.entries()));

        // Se o usuário já existe (409), tentar continuar
        if (registerResponse.status === 409) {
          console.log('Usuário já existe na API DOM, continuando...');
        } else {
          throw new Error(`Erro ao registrar na API DOM: ${registerResponse.status} - ${errorText}`);
        }
      }

      // 2. Gerar token na API DOM
      const tokenPayload = {
        email: user.email,
        password: plainPassword,
        title: `Token para ${user.name}`,
      };

      console.log('Payload de token:', { ...tokenPayload, password: '***' });

      const tokenResponse = await fetch('https://api-dom.jbmidia.com/auth/generate-token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'EbookBackend/1.0',
        },
        body: JSON.stringify(tokenPayload),
      });

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        console.log(`Erro ao gerar token (${tokenResponse.status}):`, errorText);
        console.log('Headers da resposta:', Object.fromEntries(tokenResponse.headers.entries()));
        throw new Error(`Erro ao gerar token na API DOM: ${tokenResponse.status} - ${errorText}`);
      }

      const tokenData = await tokenResponse.json();
      console.log('Token gerado na API DOM:', tokenData);

      // 3. Salvar token no sistema local (apenas para admins)
      if (user.role === 'ADMIN') {
        await this.saveAdminToken(user.id, tokenData.token, `Token Principal - ${user.name}`);
        console.log(`Token salvo para admin: ${user.email}`);
      }

    } catch (error) {
      console.error('Erro na sincronização com API DOM:', error);
      console.error('Stack trace:', error.stack);
      // Não rethrow o erro para não interromper o registro local
      console.log('Sincronização falhou, mas registro local continuará...');
    }
  }

  // NOVA FUNCIONALIDADE: Salvar token do admin
  private async saveAdminToken(adminId: string, token: string, title: string): Promise<void> {
    try {
      // Verificar se já existe um token para este admin
      const existingToken = await this.prismaService.$queryRaw`
        SELECT id FROM admin_tokens WHERE "adminId" = ${adminId}
      `;

      if (existingToken && Array.isArray(existingToken) && existingToken.length > 0) {
        // Atualizar token existente
        await this.prismaService.$executeRaw`
          UPDATE admin_tokens 
          SET token = ${token}, title = ${title}, "updatedAt" = NOW() 
          WHERE "adminId" = ${adminId}
        `;
      } else {
        // Criar novo token
        await this.prismaService.$executeRaw`
          INSERT INTO admin_tokens (id, "adminId", token, title, "isActive", "createdAt", "updatedAt")
          VALUES (gen_random_uuid(), ${adminId}, ${token}, ${title}, true, NOW(), NOW())
        `;
      }
    } catch (error) {
      console.error('Erro ao salvar token do admin:', error);
      throw error;
    }
  }

  // NOVA FUNCIONALIDADE: Buscar tokens da API DOM
  async getApiDomTokens(email: string, password: string): Promise<any> {
    try {
      console.log(`Buscando tokens para: ${email}`);

      const response = await fetch('https://api-dom.jbmidia.com/auth/list-tokens', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: email,
          password: password,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.log(`Erro ao buscar tokens (${response.status}):`, errorText);
        throw new Error(`Erro ao buscar tokens: ${response.status} - ${errorText}`);
      }

      const result = await response.json();
      console.log(`Tokens encontrados para ${email}:`, result);
      return result;
    } catch (error) {
      console.error('Erro ao buscar tokens da API DOM:', error);
      throw error;
    }
  }

  // Método público para buscar usuário por email
  async findUserByEmail(email: string): Promise<any> {
    return await this.prismaService.user.findUnique({
      where: { email },
      include: { admin: true },
    });
  }

  // NOVA FUNCIONALIDADE: Sincronizar tokens existentes
  async syncExistingTokens(userId: string, email: string, password: string): Promise<void> {
    try {
      // Buscar tokens da API DOM
      const tokensData = await this.getApiDomTokens(email, password);

      if (tokensData.tokens && tokensData.tokens.length > 0) {
        // Usar o primeiro token disponível
        const firstToken = tokensData.tokens[0];
        await this.saveAdminToken(userId, firstToken.token, firstToken.title || 'Token Sincronizado');
      }
    } catch (error) {
      console.error('Erro ao sincronizar tokens existentes:', error);
      throw error;
    }
  }
}