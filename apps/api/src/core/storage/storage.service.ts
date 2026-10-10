/** Almacenamiento de archivos subidos. En el MVP, disco local; la interfaz deja abierto S3/MinIO. */
export interface StorageService {
  /** Guarda el archivo en `key` (p. ej. `product/<uuid>.webp`) y devuelve su URL pública. */
  save(key: string, buffer: Buffer, contentType: string): Promise<{ url: string }>;
  delete(key: string): Promise<void>;
}
