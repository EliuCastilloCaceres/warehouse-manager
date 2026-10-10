import sharp from 'sharp';
import { DomainError } from '../../core/errors.js';

const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp']);
const LIMIT_INPUT_PIXELS = 50_000_000; // evita "bombas" de descompresión
const MAIN_SIZE = 1600;
const THUMB_SIZE = 400;

export interface ProcessedImage {
  main: Buffer;
  thumb: Buffer;
  width: number;
  height: number;
}

/**
 * Valida la imagen por su contenido (no por la extensión) y la convierte a WebP:
 * principal con lado mayor 1600 y miniatura con lado mayor 400, sin metadatos.
 */
export async function processImage(input: Buffer): Promise<ProcessedImage> {
  const open = () => sharp(input, { limitInputPixels: LIMIT_INPUT_PIXELS });
  try {
    const { format } = await open().metadata();
    if (!format || !ALLOWED_FORMATS.has(format)) {
      throw new DomainError('UNSUPPORTED_MEDIA_TYPE');
    }
    const resize = (size: number) =>
      open()
        .rotate()
        .resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true });
    const main = await resize(MAIN_SIZE)
      .webp({ quality: 80 })
      .toBuffer({ resolveWithObject: true });
    const thumb = await resize(THUMB_SIZE).webp({ quality: 75 }).toBuffer();
    return { main: main.data, thumb, width: main.info.width, height: main.info.height };
  } catch (error) {
    if (error instanceof DomainError) throw error;
    // Contenido que sharp no puede leer (texto, archivo corrupto o demasiado grande).
    throw new DomainError('UNSUPPORTED_MEDIA_TYPE');
  }
}
