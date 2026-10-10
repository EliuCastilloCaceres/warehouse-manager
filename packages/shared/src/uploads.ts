import { z } from 'zod';

export const IMAGE_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

export const ImageUploadDto = z.object({
  url: z.string().startsWith('/uploads/'),
  thumbUrl: z.string().startsWith('/uploads/'),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type ImageUploadDto = z.infer<typeof ImageUploadDto>;
