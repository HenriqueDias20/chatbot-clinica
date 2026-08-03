import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { logger } from './logger.js';

const run = promisify(execFile);

export type TranscodeResult = { ok: true; data: Buffer } | { ok: false; error: string };

/**
 * Converte o áudio gravado no navegador (webm/opus) para ogg/opus — o formato de
 * áudio que a Meta aceita. Requer o binário ffmpeg no sistema (ver backend/Dockerfile).
 */
export async function transcodeToOggOpus(input: Buffer): Promise<TranscodeResult> {
  let dir: string | null = null;
  try {
    dir = await mkdtemp(join(tmpdir(), 'wa-audio-'));
    const inPath = join(dir, 'in.webm');
    const outPath = join(dir, 'out.ogg');
    await writeFile(inPath, input);
    // Formato padrão de mensagem de voz do WhatsApp: opus mono 48kHz, otimizado p/ voz.
    // (48kHz + application=voip é o que o WhatsApp no iOS espera — 16kHz dava "áudio indisponível".)
    await run(
      'ffmpeg',
      [
        '-y', '-i', inPath,
        '-vn', '-ac', '1', '-ar', '48000',
        '-c:a', 'libopus', '-b:a', '32k', '-application', 'voip',
        '-f', 'ogg', outPath,
      ],
      { timeout: 30_000 },
    );
    const data = await readFile(outPath);
    if (data.length === 0) return { ok: false, error: 'Áudio convertido ficou vazio.' };
    return { ok: true, data };
  } catch (err) {
    logger.error({ err }, 'Falha ao converter áudio com ffmpeg');
    return { ok: false, error: 'Não foi possível processar o áudio gravado.' };
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
