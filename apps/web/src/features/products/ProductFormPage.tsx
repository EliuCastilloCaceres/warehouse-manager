import {
  type ProductDetailDto,
  type ProductType,
  ProductUpsertInput,
  type VariantDetailDto,
} from '@warehouse-manager/shared';
import { ArrowLeft } from 'lucide-react';
import { type ComponentProps, type FormEvent, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useAuth } from '@/features/auth/AuthProvider';
import { ApiError, errorMessage } from '@/shared/api/errors';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { notify } from '@/shared/ui/notify';
import { RadioGroup, RadioGroupItem } from '@/shared/ui/radio-group';
import { ConfirmDialog } from '@/shared/ui/ResponsiveDialog';
import { ErrorState, LoadingState } from '@/shared/ui/states';
import { productsApi, useInvalidateProducts, useProduct, useProductCatalogs } from './api';
import { ChipsInput } from './ChipsInput';
import { ProductGallery } from './ProductGallery';
import { VariantMatrixGenerator } from './VariantMatrixGenerator';
import {
  centsToPesos,
  pesosToCents,
  resuggest,
  rowFromVariant,
  type VariantRow,
} from './variantRows';
import { VariantsTable } from './VariantsTable';

interface FormState {
  sku: string;
  name: string;
  description: string;
  category: string;
  brand: string;
  price: string;
  cost: string;
  tags: string[];
  type: ProductType;
  barcode: string;
  variants: VariantRow[];
}

const MONEY_ERROR = 'Escribe un importe en pesos, p. ej. 899.00';

function initialState(product: ProductDetailDto | null): FormState {
  if (!product) {
    return {
      sku: '',
      name: '',
      description: '',
      category: '',
      brand: '',
      price: '',
      cost: '',
      tags: [],
      type: 'VARIABLE',
      barcode: '',
      variants: [],
    };
  }
  return {
    sku: product.sku,
    name: product.name,
    description: product.description ?? '',
    category: product.category?.path ?? '',
    brand: product.brand?.name ?? '',
    price: centsToPesos(product.price),
    cost: centsToPesos(product.cost),
    tags: product.tags,
    type: product.type,
    barcode: product.type === 'SIMPLE' ? (product.variants[0]?.barcode ?? '') : '',
    variants: product.type === 'VARIABLE' ? product.variants.map(rowFromVariant) : [],
  };
}

const optional = (text: string) => (text.trim() ? text.trim() : null);

/** Estado del formulario → `ProductUpsertInput` validado, o los errores por campo. */
function buildInput(
  state: FormState,
):
  | { input: ProductUpsertInput; errors?: never }
  | { input?: never; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const money = (field: string, text: string) => {
    const cents = pesosToCents(text);
    if (cents === undefined) errors[field] = MONEY_ERROR;
    return cents;
  };
  const price = money('price', state.price);
  if (price === null) errors.price = 'El precio es obligatorio';
  const cost = money('cost', state.cost);
  const variants = state.variants.map((row, i) => ({
    ...(row.id ? { id: row.id } : {}),
    sku: row.sku,
    barcode: optional(row.barcode),
    size: row.size,
    color: row.color,
    material: row.material,
    priceOverride: money(`variants.${i}.priceOverride`, row.price) ?? null,
  }));
  const result = ProductUpsertInput.safeParse({
    sku: state.sku,
    name: state.name,
    description: optional(state.description),
    category: optional(state.category),
    brand: optional(state.brand),
    type: state.type,
    price: price ?? 0,
    cost: cost ?? null,
    tags: state.tags,
    barcode: state.type === 'SIMPLE' ? optional(state.barcode) : null,
    variants: state.type === 'VARIABLE' ? variants : [],
  });
  if (!result.success) {
    for (const issue of result.error.issues) {
      errors[issue.path.join('.')] ??= issue.message;
    }
  }
  if (Object.keys(errors).length > 0 || !result.success) return { errors };
  return { input: result.data };
}

/** `/products/new` y `/products/:id` (spec F6 §7). */
export function ProductFormPage() {
  const { id } = useParams();
  const product = useProduct(id);
  if (id && product.isError) {
    return (
      <ErrorState message={errorMessage(product.error)} onRetry={() => void product.refetch()} />
    );
  }
  if (id && !product.data) return <LoadingState />;
  return <ProductForm key={product.data?.updatedAt ?? 'new'} product={product.data ?? null} />;
}

function ProductForm({ product }: { product: ProductDetailDto | null }) {
  const { can } = useAuth();
  const navigate = useNavigate();
  const invalidate = useInvalidateProducts();
  const catalogs = useProductCatalogs();
  const readOnly = !can('products.manage');
  const [state, setState] = useState(() => initialState(product));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [locked, setLocked] = useState<{ variantId: string; sku: string } | null>(null);
  const [confirm, setConfirm] = useState<'delete' | 'deactivate' | null>(null);

  const set = <K extends keyof FormState>(field: K, value: FormState[K]) =>
    setState((current) => ({ ...current, [field]: value }));

  const run = async (action: () => Promise<unknown>, success: string) => {
    try {
      await action();
      notify.success(success);
      await invalidate();
    } catch (error) {
      notify.error(error);
    }
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const result = buildInput(state);
    if (result.errors) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setLocked(null);
    setSaving(true);
    try {
      if (product) {
        await productsApi.update(product.id, result.input);
        notify.success('Producto guardado');
        await invalidate();
      } else {
        const created = await productsApi.create(result.input);
        notify.success('Producto creado');
        await invalidate();
        navigate(`/products/${created.id}`, { replace: true });
      }
    } catch (error) {
      if (error instanceof ApiError && error.code === 'SKU_TAKEN') {
        const { field } = error.details as { field: string };
        setErrors({ [field]: error.message });
      } else if (error instanceof ApiError && error.code === 'VARIANT_HAS_HISTORY') {
        setLocked(error.details as { variantId: string; sku: string });
      } else if (
        error instanceof ApiError &&
        error.code === 'VALIDATION_ERROR' &&
        Array.isArray(error.details)
      ) {
        setErrors(
          Object.fromEntries(
            (error.details as { path: string; message: string }[]).map((d) => [d.path, d.message]),
          ),
        );
      } else {
        notify.error(error);
      }
    } finally {
      setSaving(false);
    }
  };

  /** La variante con historial se desactiva y vuelve a la tabla (sigue en el producto). */
  const deactivateLocked = async () => {
    const variant = product!.variants.find((v) => v.id === locked!.variantId)!;
    await run(
      () => productsApi.setVariantActive(product!.id, variant.id, false),
      'Variante desactivada',
    );
    set('variants', [...state.variants, rowFromVariant({ ...variant, isActive: false })]);
    setLocked(null);
  };

  const toggleVariant = (variant: VariantDetailDto, isActive: boolean) =>
    void run(
      () => productsApi.setVariantActive(product!.id, variant.id, isActive),
      isActive ? 'Variante reactivada' : 'Variante desactivada',
    );

  const field = (
    name: 'sku' | 'name' | 'price' | 'cost' | 'category' | 'brand' | 'barcode',
    label: string,
    props: ComponentProps<'input'> = {},
  ) => (
    <div className="space-y-1">
      <Label htmlFor={`product-${name}`}>{label}</Label>
      <Input
        id={`product-${name}`}
        value={state[name]}
        readOnly={readOnly}
        aria-invalid={!!errors[name]}
        autoComplete="off"
        {...props}
        onChange={(event) => {
          const value = event.target.value;
          if (name === 'sku') {
            setState((current) => ({
              ...current,
              sku: value,
              variants: resuggest(current.variants, value),
            }));
          } else {
            set(name, value);
          }
        }}
      />
      {errors[name] && <p className="text-sm text-destructive">{errors[name]}</p>}
    </div>
  );

  const price = pesosToCents(state.price);
  return (
    <section className="flex max-w-4xl min-w-0 flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Link
          to="/products"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Productos
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold">{product ? product.name : 'Nuevo producto'}</h1>
          {product && !product.isActive && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs">Inactivo</span>
          )}
        </div>
      </div>

      <form
        onSubmit={(event) => void onSubmit(event)}
        noValidate
        className="flex min-w-0 flex-col gap-6"
      >
        {/* min-w-0: un fieldset crece hasta su contenido; sin esto, una tabla ancha estira la página. */}
        <fieldset className="grid min-w-0 gap-3 sm:grid-cols-2">
          <legend className="mb-2 font-medium">Datos generales</legend>
          {field('sku', 'SKU', { autoCapitalize: 'characters', className: 'font-mono' })}
          {field('name', 'Nombre')}
          {field('category', 'Categoría', {
            list: 'product-categories',
            placeholder: 'Calzado > Dama',
          })}
          {field('brand', 'Marca', { list: 'product-brands' })}
          {field('price', 'Precio ($)', { inputMode: 'decimal', placeholder: '899.00' })}
          {field('cost', 'Costo ($)', { inputMode: 'decimal' })}
          <datalist id="product-categories">
            {catalogs.data?.categories.map((c) => (
              <option key={c.id} value={c.path} />
            ))}
          </datalist>
          <datalist id="product-brands">
            {catalogs.data?.brands.map((b) => (
              <option key={b.id} value={b.name} />
            ))}
          </datalist>
          <div className="sm:col-span-2">
            <ChipsInput
              id="product-tags"
              label="Etiquetas"
              values={state.tags}
              onChange={(tags) => set('tags', tags)}
              maxLength={30}
              disabled={readOnly}
            />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="product-description">Descripción</Label>
            <textarea
              id="product-description"
              value={state.description}
              readOnly={readOnly}
              rows={3}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs md:text-sm"
              onChange={(event) => set('description', event.target.value)}
            />
          </div>
        </fieldset>

        <fieldset className="flex min-w-0 flex-col gap-2">
          <legend className="mb-2 font-medium">Tipo</legend>
          <RadioGroup
            aria-label="Tipo"
            value={state.type}
            disabled={readOnly || product?.hasHistory}
            onValueChange={(type) => set('type', type as ProductType)}
            className="flex gap-6"
          >
            {(
              [
                ['SIMPLE', 'Simple'],
                ['VARIABLE', 'Con variantes'],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="flex min-h-11 items-center gap-2">
                <RadioGroupItem value={value} />
                {label}
              </label>
            ))}
          </RadioGroup>
          {product?.hasHistory && (
            <p className="text-sm text-muted-foreground">
              El tipo no se puede cambiar: el producto tiene movimientos o ventas.
            </p>
          )}
          {errors.variants && <p className="text-sm text-destructive">{errors.variants}</p>}
        </fieldset>

        {state.type === 'SIMPLE' ? (
          <div className="max-w-sm">
            {field('barcode', 'Código de barras', { inputMode: 'numeric' })}
          </div>
        ) : (
          <fieldset className="flex min-w-0 flex-col gap-3">
            <legend className="mb-2 font-medium">Variantes</legend>
            <VariantMatrixGenerator
              parentSku={state.sku}
              rows={state.variants}
              onChange={(rows) => set('variants', rows)}
              disabled={readOnly}
            />
            <VariantsTable
              rows={state.variants}
              onChange={(rows) => set('variants', rows)}
              productPrice={price ?? null}
              saved={product?.variants}
              onToggleActive={product && !readOnly ? toggleVariant : undefined}
              errors={errors}
              readOnly={readOnly}
            />
            {locked && (
              <div
                role="alert"
                className="flex flex-wrap items-center gap-3 rounded-md border border-destructive/40 p-3 text-sm"
              >
                <span>
                  La variante {locked.sku} tiene movimientos o ventas y no se puede quitar.
                  Desactívala para que deje de usarse.
                </span>
                <Button type="button" variant="outline" onClick={() => void deactivateLocked()}>
                  Desactivar variante
                </Button>
              </div>
            )}
          </fieldset>
        )}

        {!readOnly && (
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={saving}>
              {product ? 'Guardar' : 'Crear producto'}
            </Button>
            {product && (
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  product.isActive
                    ? setConfirm('deactivate')
                    : void run(() => productsApi.setActive(product.id, true), 'Producto reactivado')
                }
              >
                {product.isActive ? 'Desactivar' : 'Reactivar'}
              </Button>
            )}
            {product && !product.hasHistory && (
              <Button type="button" variant="destructive" onClick={() => setConfirm('delete')}>
                Eliminar
              </Button>
            )}
          </div>
        )}
      </form>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Imágenes (máx. 10)</h2>
        {product ? (
          <ProductGallery product={product} readOnly={readOnly} />
        ) : (
          <p className="text-sm text-muted-foreground">Guarda el producto para agregar imágenes.</p>
        )}
      </section>

      {product && (
        <ConfirmDialog
          open={confirm !== null}
          onOpenChange={(open) => !open && setConfirm(null)}
          title={
            confirm === 'delete' ? `¿Eliminar ${product.name}?` : `¿Desactivar ${product.name}?`
          }
          description={
            confirm === 'delete'
              ? 'Se borran el producto, sus variantes y sus imágenes.'
              : 'No se podrá vender ni imprimir sus etiquetas.'
          }
          confirmLabel={confirm === 'delete' ? 'Eliminar' : 'Desactivar'}
          destructive
          onConfirm={() =>
            confirm === 'delete'
              ? void run(async () => {
                  await productsApi.remove(product.id);
                  navigate('/products', { replace: true });
                }, 'Producto eliminado')
              : void run(() => productsApi.setActive(product.id, false), 'Producto desactivado')
          }
        />
      )}
    </section>
  );
}
