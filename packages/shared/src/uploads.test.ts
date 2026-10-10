import { IMAGE_UPLOAD_MAX_BYTES, ImageUploadDto } from './index.js';

describe('ImageUploadDto (T8)', () => {
  const valid = {
    url: '/uploads/product/a.webp',
    thumbUrl: '/uploads/product/a.thumb.webp',
    width: 1600,
    height: 1067,
  };

  it('acepta URLs con el prefijo /uploads/', () => {
    expect(ImageUploadDto.parse(valid)).toEqual(valid);
    expect(IMAGE_UPLOAD_MAX_BYTES).toBe(10 * 1024 * 1024);
  });

  it.each([
    { ...valid, url: 'https://otro.com/a.webp' },
    { ...valid, thumbUrl: '/static/a.webp' },
    { ...valid, width: 0 },
  ])('rechaza %o', (payload) => {
    expect(ImageUploadDto.safeParse(payload).success).toBe(false);
  });
});
