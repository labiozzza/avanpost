import { appendFile, chmod, mkdir } from 'node:fs/promises';
import path from 'node:path';

export interface LiteMagicLinkMessage {
  to: string;
  url: string;
  purpose: 'link_email' | 'login';
}

/** Production delivery adapter plus a permission-restricted local outbox for disposable QA. */
export async function deliverLiteMagicLink(message: LiteMagicLinkMessage): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    const apiKey = process.env.AVANPOST_LITE_EMAIL_API_KEY;
    const from = process.env.AVANPOST_LITE_EMAIL_FROM;
    if (!apiKey || !from) throw new Error('LITE_EMAIL_PROVIDER_NOT_CONFIGURED');
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [message.to],
        subject: 'Вход в Аванпост',
        html: `<p>Чтобы продолжить, откройте ссылку:</p><p><a href="${message.url}">Войти в поселение</a></p><p>Ссылка одноразовая и действует 15 минут.</p>`
      })
    });
    if (!response.ok) throw new Error(`LITE_EMAIL_PROVIDER_REJECTED_${response.status}`);
    return;
  }

  const mailboxPath = process.env.AVANPOST_V2_TEST_MAILBOX_PATH;
  if (!mailboxPath) throw new Error('LITE_TEST_MAILBOX_NOT_CONFIGURED');
  const absolutePath = path.resolve(mailboxPath);
  await mkdir(path.dirname(absolutePath), { recursive: true, mode: 0o700 });
  await appendFile(absolutePath, `${JSON.stringify({ ...message, createdAt: new Date().toISOString() })}\n`, {
    encoding: 'utf8', mode: 0o600
  });
  await chmod(absolutePath, 0o600);
}
