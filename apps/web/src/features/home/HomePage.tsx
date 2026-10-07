import { HealthStatus } from '@/features/health/HealthStatus';

export function HomePage() {
  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold">Inicio</h1>
      <HealthStatus />
    </section>
  );
}
