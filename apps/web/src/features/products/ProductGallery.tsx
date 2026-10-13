import {
  PRODUCT_IMAGE_MAX,
  type ProductDetailDto,
  type ProductImageDto,
  variantLabel,
} from '@warehouse-manager/shared';
import { ArrowDown, ArrowUp, Camera, Star, Trash2, Upload } from 'lucide-react';
import { type ChangeEvent, useRef, useState } from 'react';
import { Button } from '@/shared/ui/button';
import { notify } from '@/shared/ui/notify';
import { ConfirmDialog } from '@/shared/ui/ResponsiveDialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { productsApi, useInvalidateProducts } from './api';

const WHOLE_PRODUCT = 'all';
const ACCEPT = 'image/jpeg,image/png,image/webp';

/**
 * Imágenes del producto (máx. 10): la primera es la principal; se ordenan, se asignan a una
 * variante y se quitan (el archivo se conserva). Spec F6 §7.
 */
export function ProductGallery({
  product,
  readOnly,
}: {
  product: ProductDetailDto;
  readOnly?: boolean;
}) {
  const invalidate = useInvalidateProducts();
  const cameraInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<ProductImageDto | null>(null);
  const images = product.images;
  const full = images.length >= PRODUCT_IMAGE_MAX;

  const run = async (action: () => Promise<unknown>, success?: string) => {
    setBusy(true);
    try {
      await action();
      if (success) notify.success(success);
      await invalidate();
    } catch (error) {
      notify.error(error);
    } finally {
      setBusy(false);
    }
  };

  const upload = (file: File | undefined) => {
    if (!file) return;
    void run(async () => {
      const uploaded = await productsApi.uploadImage(file);
      await productsApi.addImage(product.id, { url: uploaded.url, thumbUrl: uploaded.thumbUrl });
    }, 'Imagen agregada');
  };

  const move = (index: number, delta: -1 | 1) => {
    const ids = images.map((image) => image.id);
    [ids[index], ids[index + delta]] = [ids[index + delta]!, ids[index]!];
    void run(() => productsApi.orderImages(product.id, ids));
  };

  const fileInputProps = (capture: boolean) => ({
    type: 'file',
    accept: ACCEPT,
    className: 'sr-only',
    tabIndex: -1,
    ...(capture ? { capture: 'environment' as const } : {}),
    onChange: (event: ChangeEvent<HTMLInputElement>) => {
      upload(event.target.files?.[0]);
      event.target.value = '';
    },
  });

  return (
    <div className="flex flex-col gap-3">
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2">
          <input ref={cameraInput} aria-label="Tomar foto" {...fileInputProps(true)} />
          <input ref={fileInput} aria-label="Subir archivo" {...fileInputProps(false)} />
          <Button
            type="button"
            variant="outline"
            disabled={full || busy}
            onClick={() => cameraInput.current?.click()}
          >
            <Camera />
            Tomar foto
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={full || busy}
            onClick={() => fileInput.current?.click()}
          >
            <Upload />
            Subir archivo
          </Button>
          <span className="text-sm text-muted-foreground">
            {images.length} de {PRODUCT_IMAGE_MAX}
          </span>
        </div>
      )}
      {images.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sin imágenes.</p>
      ) : (
        <ul aria-label="Imágenes" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {images.map((image, index) => (
            <li key={image.id} className="flex flex-col gap-2 rounded-md border p-2">
              <div className="relative">
                <img
                  src={image.thumbUrl}
                  alt={`Imagen ${index + 1}`}
                  className="aspect-square w-full rounded object-cover"
                />
                {index === 0 && (
                  <span className="absolute top-1 left-1 flex items-center gap-1 rounded bg-background/90 px-1.5 py-0.5 text-xs font-medium">
                    <Star aria-hidden className="size-3 fill-current" />
                    Principal
                  </span>
                )}
              </div>
              {!readOnly && (
                <>
                  <Select
                    value={image.variantId ?? WHOLE_PRODUCT}
                    disabled={busy}
                    onValueChange={(value) =>
                      void run(() =>
                        productsApi.assignImage(
                          product.id,
                          image.id,
                          value === WHOLE_PRODUCT ? null : value,
                        ),
                      )
                    }
                  >
                    <SelectTrigger
                      aria-label={`Variante de la imagen ${index + 1}`}
                      className="w-full"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={WHOLE_PRODUCT}>Todo el producto</SelectItem>
                      {product.variants.map((variant) => (
                        <SelectItem key={variant.id} value={variant.id}>
                          {variantLabel(variant) ?? variant.sku}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="flex justify-between">
                    <div className="flex">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Subir la imagen ${index + 1}`}
                        disabled={busy || index === 0}
                        onClick={() => move(index, -1)}
                      >
                        <ArrowUp />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Bajar la imagen ${index + 1}`}
                        disabled={busy || index === images.length - 1}
                        onClick={() => move(index, 1)}
                      >
                        <ArrowDown />
                      </Button>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Quitar la imagen ${index + 1}`}
                      disabled={busy}
                      onClick={() => setRemoving(image)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title="¿Quitar la imagen?"
        description="Deja de mostrarse en el producto."
        confirmLabel="Quitar"
        destructive
        onConfirm={() => {
          const image = removing!;
          void run(() => productsApi.removeImage(product.id, image.id), 'Imagen quitada');
        }}
      />
    </div>
  );
}
