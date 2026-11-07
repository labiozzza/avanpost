import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { deliverLiteMagicLink } from '../src/lite-email.js';

const originalMailboxPath = process.env.AVANPOST_V2_TEST_MAILBOX_PATH;
const originalNodeEnv = process.env.NODE_ENV;
const originalApiKey = process.env.AVANPOST_LITE_EMAIL_API_KEY;
const originalFrom = process.env.AVANPOST_LITE_EMAIL_FROM;
let temporaryDirectory: string | undefined;

afterEach(async () => {
  if (originalMailboxPath === undefined) delete process.env.AVANPOST_V2_TEST_MAILBOX_PATH;
  else process.env.AVANPOST_V2_TEST_MAILBOX_PATH = originalMailboxPath;
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  if (originalApiKey === undefined) delete process.env.AVANPOST_LITE_EMAIL_API_KEY;
  else process.env.AVANPOST_LITE_EMAIL_API_KEY = originalApiKey;
  if (originalFrom === undefined) delete process.env.AVANPOST_LITE_EMAIL_FROM;
  else process.env.AVANPOST_LITE_EMAIL_FROM = originalFrom;
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
  temporaryDirectory = undefined;
});

describe('Peace Lite email delivery', () => {
  it('writes local test links only to a private, non-API mailbox file', async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'peace-lite-mailbox-'));
    const mailbox = path.join(temporaryDirectory, 'mail.jsonl');
    process.env.NODE_ENV = 'test';
    process.env.AVANPOST_V2_TEST_MAILBOX_PATH = mailbox;
    const message = { to: 'player@example.test', url: 'http://localhost:14174/auth/email/verify?token=secret', purpose: 'login' as const };

    await deliverLiteMagicLink(message);

    expect(JSON.parse((await readFile(mailbox, 'utf8')).trim())).toMatchObject(message);
    expect((await stat(mailbox)).mode & 0o777).toBe(0o600);
  });

  it('fails closed in production if email provider credentials are absent', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.AVANPOST_LITE_EMAIL_API_KEY;
    delete process.env.AVANPOST_LITE_EMAIL_FROM;

    await expect(deliverLiteMagicLink({
      to: 'player@example.test', url: 'https://game.example.test/auth/email/verify?token=secret', purpose: 'login'
    })).rejects.toThrow('LITE_EMAIL_PROVIDER_NOT_CONFIGURED');
  });
});
