import { Link } from 'react-router';

export function NoAccessPage() {
  return (
    <section className="space-y-3">
      <h1 className="text-xl font-semibold">Sin acceso</h1>
      <p>No tienes permiso para ver esta sección.</p>
      <Link to="/" className="inline-block underline">
        Ir a Inicio
      </Link>
    </section>
  );
}
