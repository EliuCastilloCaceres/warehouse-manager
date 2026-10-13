import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toaster } from '@/shared/ui/sonner';
import { CredentialsDialog } from './CredentialsDialog';

const credentials = { fullName: 'Juan Pérez', username: 'jperez', password: 'k7mp-x3qa-9vtw' };

describe('CredentialsDialog (T27)', () => {
  const writeText = jest.fn(async () => {});

  const setup = () => {
    // Después de userEvent.setup(), que instala su propio portapapeles.
    const user = userEvent.setup();
    writeText.mockClear();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const onClose = jest.fn();
    render(
      <>
        <CredentialsDialog credentials={credentials} onClose={onClose} />
        <Toaster />
      </>,
    );
    return { onClose, user };
  };

  it('muestra usuario y contraseña con el aviso', () => {
    setup();
    const dialog = screen.getByRole('dialog', { name: 'Credenciales de Juan Pérez' });
    expect(dialog).toHaveTextContent('jperez');
    expect(dialog).toHaveTextContent('k7mp-x3qa-9vtw');
    expect(dialog).toHaveTextContent('Esta contraseña no se volverá a mostrar.');
  });

  it('"Copiar" copia la contraseña al portapapeles', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Copiar' }));
    expect(writeText).toHaveBeenCalledWith('k7mp-x3qa-9vtw');
    expect(await screen.findByText('Contraseña copiada')).toBeInTheDocument();
  });

  it('Escape y el clic fuera no lo cierran; "Entendido" sí', async () => {
    const { onClose, user } = setup();

    await user.keyboard('{Escape}');
    fireEvent.pointerDown(document.body);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Entendido' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('sin credenciales no muestra nada', () => {
    render(<CredentialsDialog credentials={null} onClose={() => {}} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
