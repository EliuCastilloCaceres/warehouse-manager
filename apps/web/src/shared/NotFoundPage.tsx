import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <section>
      <h1 className="text-xl font-semibold">Página no encontrada</h1>
      <Link to="/" className="mt-2 inline-block underline">
        Ir a Inicio
      </Link>
    </section>
  );
}
