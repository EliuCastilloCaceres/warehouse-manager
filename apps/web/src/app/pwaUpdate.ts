import { toast } from 'sonner';

export const UPDATE_AVAILABLE_MESSAGE = 'Hay una nueva versión disponible';

/** Aviso persistente de versión nueva; "Actualizar" llama a `update` una sola vez. */
export function showUpdateToast(update: () => unknown): void {
  let updating = false;
  toast(UPDATE_AVAILABLE_MESSAGE, {
    id: 'pwa-update',
    duration: Number.POSITIVE_INFINITY,
    action: {
      label: 'Actualizar',
      onClick: () => {
        if (updating) return;
        updating = true;
        void update();
      },
    },
  });
}
