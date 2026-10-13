import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import {
  MISSING_PARENT_SKU,
  NO_NEW_COMBINATIONS,
  VariantMatrixGenerator,
} from './VariantMatrixGenerator';
import type { VariantRow } from './variantRows';
import { VariantsTable } from './VariantsTable';

function Harness({ parentSku = 'ZAP0101' }: { parentSku?: string }) {
  const [rows, setRows] = useState<VariantRow[]>([]);
  return (
    <>
      <VariantMatrixGenerator parentSku={parentSku} rows={rows} onChange={setRows} />
      <VariantsTable rows={rows} onChange={setRows} productPrice={89900} errors={{}} />
    </>
  );
}

const skus = () =>
  within(screen.getByRole('table', { name: 'Variantes' }))
    .getAllByRole('textbox', { name: /^SKU de la variante/ })
    .map((input) => (input as HTMLInputElement).value);

describe('VariantMatrixGenerator (T28)', () => {
  it('tallas × colores generan las filas con SKU sugerido, sin duplicar y respetando ediciones', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const add = async (label: string, values: string[]) => {
      for (const value of values)
        await user.type(screen.getByRole('textbox', { name: label }), `${value}{Enter}`);
    };
    await add('Tallas', ['23', '23.5']);
    await add('Colores', ['Negro', 'Café']);
    await user.click(screen.getByRole('button', { name: 'Generar combinaciones' }));

    expect(skus()).toEqual([
      'ZAP0101-23-NEG',
      'ZAP0101-23-CAF',
      'ZAP0101-235-NEG',
      'ZAP0101-235-CAF',
    ]);
    expect(screen.getByRole('status')).toHaveTextContent('Se agregaron 4 variantes.');

    const first = screen.getByRole('textbox', { name: 'SKU de la variante 1' });
    await user.clear(first);
    await user.type(first, 'ZAP0101-23-N');
    await user.click(screen.getByRole('button', { name: 'Generar combinaciones' }));
    expect(screen.getByRole('status')).toHaveTextContent(NO_NEW_COMBINATIONS);
    expect(skus()).toEqual([
      'ZAP0101-23-N',
      'ZAP0101-23-CAF',
      'ZAP0101-235-NEG',
      'ZAP0101-235-CAF',
    ]);

    await add('Colores', ['Blanco']);
    await user.click(screen.getByRole('button', { name: 'Generar combinaciones' }));
    expect(skus()).toEqual([
      'ZAP0101-23-N',
      'ZAP0101-23-CAF',
      'ZAP0101-235-NEG',
      'ZAP0101-235-CAF',
      'ZAP0101-23-BLA',
      'ZAP0101-235-BLA',
    ]);
    expect(screen.getByRole('status')).toHaveTextContent('Se agregaron 2 variantes.');
  });

  it('no repite un valor (sin mayúsculas) y se quita con ✕', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByRole('textbox', { name: 'Colores' }), 'Negro{Enter}');
    await user.type(screen.getByRole('textbox', { name: 'Colores' }), 'negro{Enter}');
    expect(
      within(screen.getByRole('list', { name: 'Colores' })).getAllByRole('listitem'),
    ).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Quitar Negro' }));
    expect(screen.queryByRole('list', { name: 'Colores' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generar combinaciones' })).toBeDisabled();
  });

  it('"Quitar" saca la fila de la tabla', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByRole('textbox', { name: 'Tallas' }), '25{Enter}');
    await user.click(screen.getByRole('button', { name: 'Generar combinaciones' }));
    await user.click(screen.getByRole('button', { name: 'Quitar la variante ZAP0101-25' }));
    expect(screen.getByText('Aún no hay variantes.')).toBeInTheDocument();
  });

  it('sin SKU del producto avisa que lo escriba para sugerir los SKU', async () => {
    const user = userEvent.setup();
    render(<Harness parentSku="" />);
    await user.type(screen.getByRole('textbox', { name: 'Tallas' }), '25{Enter}');
    await user.click(screen.getByRole('button', { name: 'Generar combinaciones' }));
    expect(screen.getByRole('status')).toHaveTextContent(
      `Se agregó 1 variante. ${MISSING_PARENT_SKU}`,
    );
  });
});
