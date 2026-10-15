import { History, Receipt, ShoppingBag, Wallet } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Can } from '@/features/auth/guards';
import { useDeviceSession } from './api';

function Shortcut({ to, icon, children }: { to: string; icon: ReactNode; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="flex min-h-28 flex-col items-center justify-center gap-2 rounded-lg border p-3 text-center text-lg font-medium hover:bg-muted/50"
    >
      {icon}
      <span>{children}</span>
    </Link>
  );
}

/** `/pos`: [Atender] y [Cobrar]; "Mi caja" solo si el dispositivo tiene una caja abierta. */
export function PosHomePage() {
  const device = useDeviceSession();
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Punto de venta</h1>
      <nav aria-label="Punto de venta" className="grid grid-cols-2 gap-3">
        <Shortcut to="/pos/sell" icon={<ShoppingBag aria-hidden className="size-8" />}>
          Atender
        </Shortcut>
        <Shortcut to="/pos/carts" icon={<Wallet aria-hidden className="size-8" />}>
          Cobrar
        </Shortcut>
      </nav>
      {device.isOpen && device.session && (
        <section aria-label="Mi caja" className="flex flex-col gap-2">
          <h2 className="font-medium">
            Mi caja · {device.session.cashRegister.code} · {device.session.cashRegister.name}
          </h2>
          <div className="grid grid-cols-2 gap-3">
            <Shortcut to="/pos/sales" icon={<History aria-hidden className="size-6" />}>
              Historial
            </Shortcut>
            <Can perm="pos.session.close">
              <Shortcut to="/pos/close" icon={<Receipt aria-hidden className="size-6" />}>
                Corte
              </Shortcut>
            </Can>
          </div>
        </section>
      )}
    </section>
  );
}
