import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

/**
 * Supabase Storage via API REST (sem dependência nova).
 * Bucket PRIVADO: o painel nunca acessa direto — pede ao backend, que devolve
 * um link assinado e temporário.
 */

const BASE = env.SUPABASE_URL ? `${env.SUPABASE_URL.replace(/\/+$/, '')}/storage/v1` : '';
const BUCKET = env.MEDIA_BUCKET;
const KEY = env.SUPABASE_SERVICE_KEY;

export const storageConfigured = Boolean(BASE) && Boolean(KEY);

export type UploadResult = { ok: true; path: string } | { ok: false; error: string };
export type SignResult = { ok: true; url: string } | { ok: false; error: string };

interface SupabaseError {
  message?: string;
  error?: string;
}

/** Extensão a partir do mime (só para o arquivo salvo ficar reconhecível). */
function extFromMime(mime: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'audio/ogg': 'ogg',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/aac': 'aac',
    'audio/amr': 'amr',
    'video/mp4': 'mp4',
    'application/pdf': 'pdf',
  };
  return map[mime.split(';')[0]!.trim()] ?? 'bin';
}

/** Caminho único dentro do bucket: conversa/ano-mes/timestamp-aleatorio.ext */
export function buildMediaPath(conversationId: string, mime: string): string {
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const rand = Math.random().toString(36).slice(2, 10);
  return `${conversationId}/${ym}/${Date.now()}-${rand}.${extFromMime(mime)}`;
}

/** Sobe o arquivo para o bucket. */
export async function uploadMedia(path: string, data: Buffer, mime: string): Promise<UploadResult> {
  if (!storageConfigured) {
    return { ok: false, error: 'Supabase Storage não configurado (SUPABASE_URL / SUPABASE_SERVICE_KEY).' };
  }
  try {
    const res = await fetch(`${BASE}/object/${BUCKET}/${encodeURI(path)}`, {
      method: 'POST',
      headers: {
        // apikey + Authorization: aceita tanto a chave legada (service_role)
        // quanto o novo formato de "secret key" do Supabase.
        apikey: KEY,
        Authorization: `Bearer ${KEY}`,
        'Content-Type': mime || 'application/octet-stream',
        'x-upsert': 'true',
      },
      body: new Uint8Array(data),
    });
    if (!res.ok) {
      const raw = (await res.json().catch(() => ({}))) as SupabaseError;
      const msg = raw.message ?? raw.error ?? `HTTP ${res.status}`;
      logger.error({ status: res.status, path, error: msg }, 'Falha ao subir mídia para o Supabase Storage');
      return { ok: false, error: msg };
    }
    logger.info({ path, mime, bytes: data.length }, 'Mídia salva no Storage');
    return { ok: true, path };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'erro desconhecido';
    logger.error({ err, path }, 'Erro de rede ao subir mídia');
    return { ok: false, error: msg };
  }
}

/** Gera um link assinado e temporário para o painel exibir o arquivo. */
export async function createSignedUrl(path: string, expiresInSeconds = 3600): Promise<SignResult> {
  if (!storageConfigured) {
    return { ok: false, error: 'Supabase Storage não configurado.' };
  }
  try {
    const res = await fetch(`${BASE}/object/sign/${BUCKET}/${encodeURI(path)}`, {
      method: 'POST',
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn: expiresInSeconds }),
    });
    const raw = (await res.json().catch(() => ({}))) as { signedURL?: string } & SupabaseError;
    if (!res.ok || !raw.signedURL) {
      const msg = raw.message ?? raw.error ?? `HTTP ${res.status}`;
      logger.error({ status: res.status, path, error: msg }, 'Falha ao assinar URL da mídia');
      return { ok: false, error: msg };
    }
    // signedURL vem relativo (ex.: /object/sign/bucket/arquivo?token=...)
    return { ok: true, url: `${BASE}${raw.signedURL.startsWith('/') ? '' : '/'}${raw.signedURL}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'erro desconhecido';
    logger.error({ err, path }, 'Erro de rede ao assinar URL da mídia');
    return { ok: false, error: msg };
  }
}
