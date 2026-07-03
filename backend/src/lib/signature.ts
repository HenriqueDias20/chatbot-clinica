import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Valida a assinatura X-Hub-Signature-256 enviada pela Meta.
 * Se appSecret estiver vazio, retorna `skipped` (o caller decide logar aviso).
 */
export function verifyMetaSignature(
  rawBody: Buffer | undefined,
  signatureHeader: string | undefined,
  appSecret: string,
): { valid: boolean; skipped: boolean } {
  if (!appSecret) return { valid: true, skipped: true };
  if (!rawBody || !signatureHeader) return { valid: false, skipped: false };

  const expected = 'sha256=' + createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return { valid: false, skipped: false };
  return { valid: timingSafeEqual(a, b), skipped: false };
}
