/** Lo que hizo un seed, para imprimir un resumen en español. */
export interface SeedSummary {
  created: string[];
  updated: string[];
  deleted: string[];
}

export function emptySummary(): SeedSummary {
  return { created: [], updated: [], deleted: [] };
}

export function formatSummary(title: string, summary: SeedSummary): string {
  const section = (label: string, items: string[]) =>
    items.length === 0
      ? `${label}: nada`
      : `${label} (${items.length}):\n${items.map((item) => `  - ${item}`).join('\n')}`;
  return [
    title,
    section('Creado', summary.created),
    section('Actualizado', summary.updated),
    section('Borrado', summary.deleted),
  ].join('\n');
}
