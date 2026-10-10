import { useNavigate } from 'react-router';
import { useAuth } from '@/features/auth/AuthProvider';
import { useBranch } from '@/features/branch/BranchProvider';
import { Button } from '@/shared/ui/button';
import { ResponsiveDialog } from '@/shared/ui/ResponsiveDialog';

export function initialsOf(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? [parts[0]![0], parts.at(-1)![0]] : [parts[0]?.[0]];
  return letters.join('').toUpperCase();
}

/** Menú de usuario: hoja inferior en celular, diálogo en escritorio. */
export function UserMenu({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { me, logout } = useAuth();
  const { branches, branch } = useBranch();
  const navigate = useNavigate();
  if (!me) return null;

  const go = (path: string) => {
    onOpenChange(false);
    navigate(path);
  };

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={me.user.fullName}
      description={me.user.role.name}
    >
      <div className="flex flex-col gap-2 pb-4">
        {branches.length > 1 && branch && (
          <div className="flex items-center justify-between gap-2 rounded-md border p-3">
            <span>
              Sucursal: {branch.code} · {branch.name}
            </span>
            <Button variant="outline" size="sm" onClick={() => go('/select-branch')}>
              Cambiar sucursal
            </Button>
          </div>
        )}
        <Button variant="outline" onClick={() => go('/dev/scanner')}>
          Probar escáner
        </Button>
        <Button
          variant="destructive"
          onClick={() => {
            onOpenChange(false);
            void logout();
          }}
        >
          Cerrar sesión
        </Button>
      </div>
    </ResponsiveDialog>
  );
}
