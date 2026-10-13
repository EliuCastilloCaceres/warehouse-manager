import { Copy, TriangleAlert } from 'lucide-react';
import { Button } from '@/shared/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog';
import { notify } from '@/shared/ui/notify';

export interface Credentials {
  fullName: string;
  username: string;
  password: string;
}

export interface CredentialsDialogProps {
  credentials: Credentials | null;
  onClose: () => void;
}

/**
 * Contraseña generada, visible una sola vez. Solo "Entendido" lo cierra: ni `Escape` ni el clic
 * fuera, para que no se pierda sin haberla anotado (spec F4 §7).
 */
export function CredentialsDialog({ credentials, onClose }: CredentialsDialogProps) {
  const copy = () => {
    if (!credentials) return;
    navigator.clipboard.writeText(credentials.password).then(
      () => notify.success('Contraseña copiada'),
      () => notify.error('No se pudo copiar'),
    );
  };

  return (
    <Dialog open={credentials !== null}>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        {credentials && (
          <>
            <DialogHeader>
              <DialogTitle>Credenciales de {credentials.fullName}</DialogTitle>
              <DialogDescription>Datos para iniciar sesión.</DialogDescription>
            </DialogHeader>
            <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2">
              <dt className="text-muted-foreground">Usuario</dt>
              <dd className="font-mono">{credentials.username}</dd>
              <dt className="text-muted-foreground">Contraseña</dt>
              <dd className="flex items-center gap-2">
                <span className="font-mono text-lg">{credentials.password}</span>
                <Button variant="outline" size="sm" onClick={copy}>
                  <Copy />
                  Copiar
                </Button>
              </dd>
            </dl>
            <p className="flex gap-2 rounded-md bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
              <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
              <span>
                Esta contraseña no se volverá a mostrar. Se pedirá cambiarla al iniciar sesión.
              </span>
            </p>
            <DialogFooter>
              <Button className="w-full" onClick={onClose}>
                Entendido
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
