import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toaster } from '@/shared/ui/sonner';
import { showUpdateToast } from './pwaUpdate';

describe('showUpdateToast (T32)', () => {
  it('muestra "Hay una nueva versión disponible"; "Actualizar" llama a update una vez', async () => {
    const update = jest.fn();
    const user = userEvent.setup();
    render(<Toaster />);

    act(() => showUpdateToast(update));
    expect(await screen.findByText('Hay una nueva versión disponible')).toBeInTheDocument();

    const button = screen.getByRole('button', { name: 'Actualizar' });
    await user.click(button);
    // Un segundo toque mientras el aviso se cierra no vuelve a actualizar.
    act(() => button.click());
    expect(update).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.queryByText('Hay una nueva versión disponible')).not.toBeInTheDocument(),
    );
  });
});
