import type { ProductImageDto } from '@warehouse-manager/shared';
import { QueryClient } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Providers } from '@/app/providers';
import { callsTo, jsonResponse, mockFetch } from '@/test/http';
import { choose } from '@/features/users/testing';
import { ProductGallery } from './ProductGallery';
import { makeDetail } from './testing';

const NOW = '2026-10-13T15:00:00.000Z';
const image = (n: number, productId: string): ProductImageDto => ({
  id: `aaaaaaaa-1111-4000-8000-${String(n).padStart(12, '0')}`,
  productId,
  variantId: null,
  url: `/uploads/product/${n}.webp`,
  thumbUrl: `/uploads/product/${n}.thumb.webp`,
  sortOrder: n,
  createdAt: NOW,
  updatedAt: NOW,
});

function setup(imageCount: number) {
  const base = makeDetail();
  const product = {
    ...base,
    images: Array.from({ length: imageCount }, (_, i) => image(i, base.id)),
  };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const user = userEvent.setup();
  render(
    <Providers queryClient={queryClient}>
      <ProductGallery product={product} />
    </Providers>,
  );
  return { product, user };
}

const body = (fetchMock: jest.Mock, key: string) => {
  const [, init] = callsTo(fetchMock, key)[0]!;
  return (init as RequestInit).body;
};

describe('ProductGallery (T30)', () => {
  it('subir llama a /uploads/product-images con FormData y luego agrega la imagen', async () => {
    const { product, user } = setup(1);
    const fetchMock = mockFetch({
      'POST /api/v1/uploads/product-images': () =>
        jsonResponse(201, {
          url: '/uploads/product/n.webp',
          thumbUrl: '/uploads/product/n.thumb.webp',
          width: 10,
          height: 10,
        }),
      [`POST /api/v1/products/${product.id}/images`]: () => jsonResponse(201, image(9, product.id)),
    });

    await user.upload(
      screen.getByLabelText('Subir archivo'),
      new File(['x'], 'foto.png', { type: 'image/png' }),
    );

    expect(await screen.findByText('Imagen agregada')).toBeInTheDocument();
    expect(body(fetchMock, 'POST /api/v1/uploads/product-images')).toBeInstanceOf(FormData);
    expect(
      JSON.parse(body(fetchMock, `POST /api/v1/products/${product.id}/images`) as string),
    ).toEqual({
      url: '/uploads/product/n.webp',
      thumbUrl: '/uploads/product/n.thumb.webp',
    });
  });

  it('mover abajo envía el nuevo orden', async () => {
    const { product, user } = setup(3);
    const fetchMock = mockFetch({
      [`PUT /api/v1/products/${product.id}/images/order`]: () => jsonResponse(200, product.images),
    });
    expect(screen.getByRole('button', { name: 'Subir la imagen 1' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Bajar la imagen 1' }));
    await waitFor(() =>
      expect(callsTo(fetchMock, `PUT /api/v1/products/${product.id}/images/order`)).toHaveLength(1),
    );
    const [first, second, third] = product.images.map((i) => i.id);
    expect(
      JSON.parse(body(fetchMock, `PUT /api/v1/products/${product.id}/images/order`) as string),
    ).toEqual({
      imageIds: [second, first, third],
    });
    expect(screen.getByText('Principal')).toBeInTheDocument();
  });

  it('asigna una imagen a una variante', async () => {
    const { product, user } = setup(1);
    const target = `PATCH /api/v1/products/${product.id}/images/${product.images[0]!.id}`;
    const fetchMock = mockFetch({ [target]: () => jsonResponse(200, product.images[0]) });
    await choose(user, 'Variante de la imagen 1', '26 · Negro');
    await waitFor(() => expect(callsTo(fetchMock, target)).toHaveLength(1));
    expect(JSON.parse(body(fetchMock, target) as string)).toEqual({
      variantId: product.variants[1]!.id,
    });
  });

  it('quitar pide confirmación', async () => {
    const { product, user } = setup(2);
    const target = `DELETE /api/v1/products/${product.id}/images/${product.images[1]!.id}`;
    const fetchMock = mockFetch({ [target]: () => jsonResponse(204) });
    await user.click(screen.getByRole('button', { name: 'Quitar la imagen 2' }));
    const dialog = await screen.findByRole('dialog', { name: '¿Quitar la imagen?' });
    expect(callsTo(fetchMock, target)).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: 'Quitar' }));
    await waitFor(() => expect(callsTo(fetchMock, target)).toHaveLength(1));
  });

  it('con 10 imágenes no se puede subir otra', () => {
    setup(10);
    expect(screen.getByText('10 de 10')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Subir archivo' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Tomar foto' })).toBeDisabled();
  });
});
