import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { setScreenWidth } from '@/test/media';
import { ApiError, NetworkError } from '@/shared/api/errors';
import { notify } from './notify';
import { ConfirmDialog, ResponsiveDialog } from './ResponsiveDialog';
import { Toaster } from './sonner';

describe('ResponsiveDialog (T24)', () => {
  it.each([
    [375, 'sheet'],
    [1024, 'dialog'],
  ])('a %i px usa la variante %s', (width, variant) => {
    setScreenWidth(width);
    render(
      <ResponsiveDialog open onOpenChange={() => {}} title="Detalle">
        <p>contenido</p>
      </ResponsiveDialog>,
    );

    const dialog = screen.getByRole('dialog', { name: 'Detalle' });
    expect(dialog).toHaveAttribute('data-variant', variant);
    expect(screen.getByText('contenido')).toBeInTheDocument();
  });
});

function ConfirmHarness({ onConfirm }: { onConfirm: () => void }) {
  const [open, setOpen] = useState(true);
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={setOpen}
      title="¿Cancelar la venta?"
      description="No se puede deshacer."
      onConfirm={onConfirm}
    />
  );
}

describe('ConfirmDialog (T24)', () => {
  it('"Confirmar" llama a onConfirm y cierra', async () => {
    const onConfirm = jest.fn();
    render(<ConfirmHarness onConfirm={onConfirm} />);

    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('"Cancelar" cierra sin llamarlo', async () => {
    const onConfirm = jest.fn();
    render(<ConfirmHarness onConfirm={onConfirm} />);

    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe('notify (T24)', () => {
  it.each([
    ['ApiError', new ApiError(409, 'CONFLICT', 'El SKU ya existe'), 'El SKU ya existe'],
    ['NetworkError', new NetworkError(), 'Sin conexión con el servidor.'],
    ['texto', 'Algo salió mal', 'Algo salió mal'],
    [
      'error desconocido',
      new Error('stack interno'),
      'Ocurrió un error inesperado. Intenta de nuevo.',
    ],
  ])('notify.error(%s) muestra su mensaje en un toast', async (_case, error, text) => {
    render(<Toaster />);
    notify.error(error);
    expect(await screen.findByText(text)).toBeInTheDocument();
  });

  it('notify.success muestra el mensaje', async () => {
    render(<Toaster />);
    notify.success('Producto guardado');
    expect(await screen.findByText('Producto guardado')).toBeInTheDocument();
  });
});
