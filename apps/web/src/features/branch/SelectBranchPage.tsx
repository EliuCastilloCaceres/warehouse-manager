import { useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { useAuth } from '@/features/auth/AuthProvider';
import { safeNext } from '@/features/auth/safeNext';
import { Button } from '@/shared/ui/button';
import { useBranch } from './BranchProvider';

export function NoBranchesPage() {
  const { logout } = useAuth();
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <div className="max-w-sm space-y-4 text-center">
        <p>Tu usuario no tiene sucursales asignadas. Pide a un administrador que te asigne una.</p>
        <Button onClick={() => void logout()}>Cerrar sesión</Button>
      </div>
    </main>
  );
}

export function SelectBranchPage() {
  const { branches, branchId, selectBranch } = useBranch();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const preselected = branchId ?? branches.find((b) => b.isDefault)?.id ?? branches[0]?.id ?? '';
  const [selected, setSelected] = useState(preselected);

  if (branches.length === 0) return <NoBranchesPage />;
  if (branches.length === 1) return <Navigate to={next} replace />;

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <form
        className="w-full max-w-sm space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          selectBranch(selected);
          navigate(next, { replace: true });
        }}
      >
        <h1 className="text-xl font-semibold">Elige la sucursal</h1>
        <fieldset className="space-y-2 rounded-md border p-2">
          <legend className="sr-only">Sucursal</legend>
          {branches.map((branch) => (
            <label key={branch.id} className="flex min-h-11 items-center gap-3 rounded-md px-2">
              <input
                type="radio"
                name="branch"
                value={branch.id}
                checked={selected === branch.id}
                onChange={() => setSelected(branch.id)}
              />
              <span>
                {branch.code} · {branch.name}
                {branch.isDefault && (
                  <span className="text-muted-foreground"> (predeterminada)</span>
                )}
              </span>
            </label>
          ))}
        </fieldset>
        <Button type="submit" className="w-full" disabled={!selected}>
          Continuar
        </Button>
      </form>
    </main>
  );
}
