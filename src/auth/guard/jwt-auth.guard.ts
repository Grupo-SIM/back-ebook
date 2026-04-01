import { Injectable, CanActivate, ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { PrismaService } from 'prisma/prisma.service';
import { Role } from 'src/types/interfaces/role';
import { isValidCpf } from 'src/common/utils/cpf.util';

interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    name: string;
    email: string;
    role: string;
    createdById?: string;
  };
}

function isCpfBypassRoute(request: any): boolean {
  const path = String(request?.originalUrl || request?.url || '');
  const normalizedPath = path.toLowerCase();
  return (
    normalizedPath.includes('/users/my-profile') ||
    normalizedPath.includes('/auth/logout') ||
    normalizedPath.includes('/checkout') ||
    normalizedPath.includes('/favorites') ||
    normalizedPath.includes('/books/purchased') ||
    normalizedPath.includes('/purchase-status')
  );
}

async function enforceCpfRequirement(request: AuthenticatedRequest, prisma: PrismaService): Promise<void> {
  const user = request?.user;
  if (!user || !['ADMIN', 'USER', 'CUSTOMER'].includes(user.role)) return;
  if (isCpfBypassRoute(request)) return;

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { cpf: true },
  });
  if (isValidCpf(dbUser?.cpf)) return;

  throw new ForbiddenException({
    message: 'CPF obrigatório. Configure seu CPF para continuar.',
    code: 'CPF_REQUIRED',
  });
}

@Injectable()
export class JwtAuthGuardUser extends AuthGuard('jwt') {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async canActivate(context: ExecutionContext) {
    await super.canActivate(context);
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    await enforceCpfRequirement(req, this.prisma);
    return true;
  }

  handleRequest(err: any, user: any, info: any) {
    if (err || !user) {
      throw err || new UnauthorizedException();
    }
    return user;
  }
}

@Injectable()
export class JwtAuthGuardAdmin extends AuthGuard('jwt') implements CanActivate {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async canActivate(context: ExecutionContext) {
    await super.canActivate(context);
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    await enforceCpfRequirement(req, this.prisma);
    return true;
  }

  handleRequest(err: any, user: any, info: any) {
    if (err || !user) {
      throw err || new UnauthorizedException();
    }

    if (user.role !== 'ADMIN') {
      throw new UnauthorizedException('Access denied. Admin role required.');
    }

    return user;
  }
}

@Injectable()
export class JwtAuthGuardCustomer extends AuthGuard('jwt') implements CanActivate {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async canActivate(context: ExecutionContext) {
    await super.canActivate(context);
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    await enforceCpfRequirement(req, this.prisma);
    return true;
  }

  handleRequest(err: any, user: any, info: any) {
    if (err || !user) {
      throw err || new UnauthorizedException();
    }

    if (user.role !== 'CUSTOMER') {
      throw new UnauthorizedException('Access denied. Customer role required.');
    }

    return user;
  }
}

@Injectable()
export class JwtAuthGuardAdminOrUser extends AuthGuard('jwt') implements CanActivate {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async canActivate(context: ExecutionContext) {
    await super.canActivate(context);
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    await enforceCpfRequirement(req, this.prisma);
    return true;
  }

  handleRequest(err: any, user: any, info: any) {
    if (err || !user) {
      throw err || new UnauthorizedException();
    }

    if (!['ADMIN', 'USER'].includes(user.role)) {
      throw new UnauthorizedException('Access denied. Admin or User role required.');
    }

    return user;
  }
}

@Injectable()
export class JwtAuthGuardAdminOrCustomer extends AuthGuard('jwt') implements CanActivate {
  constructor(
    private reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    await super.canActivate(context);
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = req.user;

    if (!user) {
      throw new UnauthorizedException('User not authenticated');
    }

    if (user.role !== Role.ADMIN && user.role !== Role.CUSTOMER) {
      throw new UnauthorizedException('Access denied. Admin or Customer role required.');
    }

    await enforceCpfRequirement(req, this.prisma);

    return true;
  }
}

@Injectable()
export class JwtAuthGuardPanel extends AuthGuard('jwt') implements CanActivate {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async canActivate(context: ExecutionContext) {
    await super.canActivate(context);
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    await enforceCpfRequirement(req, this.prisma);
    return true;
  }

  handleRequest(err: any, user: any, info: any) {
    if (err || !user) {
      throw err || new UnauthorizedException();
    }

    if (!['ADMIN', 'CUSTOMER'].includes(user.role)) {
      throw new UnauthorizedException('Access denied. Panel access required.');
    }

    return user;
  }
}

@Injectable()
export class JwtAuthGuardAll extends AuthGuard('jwt') implements CanActivate {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    const token = this.extractTokenFromHeader(request);

    // Token especial para checkout
    const CHECKOUT_TOKEN = 'checkout-token-2025-simint';

    if (token === CHECKOUT_TOKEN) {
      // Criar um "usuário fake" para o checkout e permitir acesso
      request.user = {
        id: 'checkout-system',
        role: 'CHECKOUT',
        name: 'Sistema de Checkout'
      };
      return true; // Permite acesso imediatamente
    }

    // Continua com autenticação JWT normal
    await super.canActivate(context);
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    await enforceCpfRequirement(req, this.prisma);
    return true;
  }

  handleRequest(err: any, user: any, info: any) {
    // Se for o usuário de checkout, permite acesso
    if (user && user.id === 'checkout-system' && user.role === 'CHECKOUT') {
      return user;
    }

    if (err || !user) {
      throw err || new UnauthorizedException();
    }

    if (!['ADMIN', 'USER', 'CUSTOMER'].includes(user.role)) {
      throw new UnauthorizedException('Access denied. Valid role required.');
    }

    return user;
  }

  private extractTokenFromHeader(request: any): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}