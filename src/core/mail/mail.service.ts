import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';
import type { Env } from '../config/env.schema';

/**
 * Envio de e-mail transacional.
 *
 * Em desenvolvimento aponta para o Mailhog do docker-compose, onde as
 * mensagens ficam visíveis em http://localhost:8025 sem sair da máquina.
 * Em produção, o comprador troca host e porta pelo provedor dele.
 */
@Injectable()
export class MailService {
  private readonly transporter: Transporter;

  constructor(private readonly config: ConfigService<Env, true>) {
    this.transporter = createTransport({
      host: this.config.get('MAIL_HOST', { infer: true }),
      port: this.config.get('MAIL_PORT', { infer: true }),
      secure: false,
    });
  }

  async send(to: string, subject: string, body: string): Promise<void> {
    await this.transporter.sendMail({
      from: this.config.get('MAIL_FROM', { infer: true }),
      to,
      subject,
      text: body,
    });
  }
}
