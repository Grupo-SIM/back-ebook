import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Request } from 'express';
import { Observable, map } from 'rxjs';

const SENSITIVE_FIELDS = new Set(['downloadUrl']);

function stripSensitiveFields(value: unknown, seen = new WeakSet<object>()): unknown {
    if (value === null || typeof value !== 'object') return value;
    if (seen.has(value)) return value;
    seen.add(value);

    if (Array.isArray(value)) {
        return value.map(item => stripSensitiveFields(item, seen));
    }

    // Só objetos simples: Date, Buffer, Prisma Decimal etc. serializam sozinhos
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return value;

    const result: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(value)) {
        if (SENSITIVE_FIELDS.has(key)) continue;
        result[key] = stripSensitiveFields(field, seen);
    }
    return result;
}

/**
 * Remove o link permanente do arquivo (downloadUrl) de todas as respostas públicas.
 * O download só acontece via GET /books/:id/download, que valida a compra e
 * redireciona para uma URL assinada temporária. Rotas do painel admin mantêm o campo.
 */
@Injectable()
export class StripDownloadUrlInterceptor implements NestInterceptor {
    intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
        if (context.getType() !== 'http') return next.handle();

        const request = context.switchToHttp().getRequest<Request>();
        if (/^\/admins?(\/|$)/.test(request.path)) return next.handle();

        return next.handle().pipe(map(data => stripSensitiveFields(data)));
    }
}
