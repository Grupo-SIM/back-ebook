import { Injectable, Logger } from '@nestjs/common';
import * as admin from 'firebase-admin';

@Injectable()
export class FirebaseService {
  private readonly logger = new Logger(FirebaseService.name);
  private app: admin.app.App | null = null;

  constructor() {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

    if (!projectId || !clientEmail || !privateKey) {
      this.logger.warn(
        'Firebase Admin não configurado (FIREBASE_PROJECT_ID/FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY ausentes). Push notifications desabilitadas.',
      );
      return;
    }

    this.app = admin.apps.length
      ? admin.app()
      : admin.initializeApp({
          credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
        });
  }

  get enabled(): boolean {
    return this.app !== null;
  }

  async sendToTokens(
    tokens: string[],
    payload: { title: string; body: string },
  ): Promise<void> {
    if (!this.app || tokens.length === 0) return;

    try {
      const response = await admin.messaging(this.app).sendEachForMulticast({
        tokens,
        data: {
          title: payload.title,
          body: payload.body,
        },
      });
      this.logger.log(
        `Push enviado: ${response.successCount} sucesso, ${response.failureCount} falha(s)`,
      );
    } catch (err: any) {
      this.logger.error(`Falha ao enviar push notification: ${err?.message}`);
    }
  }
}
