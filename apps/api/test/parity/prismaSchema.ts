import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Parser mínimo de schema.prisma (solo lo que necesitan los tests de paridad):
// no depende del cliente generado.

export interface PrismaField {
  name: string;
  type: string;
  optional: boolean;
  list: boolean;
}

export interface PrismaSchema {
  enums: Record<string, string[]>;
  models: Record<string, PrismaField[]>;
}

const SCALARS = new Set([
  'String',
  'Int',
  'BigInt',
  'Float',
  'Decimal',
  'Boolean',
  'DateTime',
  'Json',
  'Bytes',
]);

export const SCHEMA_PATH = resolve(__dirname, '../../prisma/schema.prisma');

/** Líneas de contenido de cada bloque `kind Nombre { … }`, sin comentarios. */
function blocks(text: string, kind: 'enum' | 'model'): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  const re = new RegExp(`^${kind}\\s+(\\w+)\\s*\\{([\\s\\S]*?)^\\}`, 'gm');
  for (const match of text.matchAll(re)) {
    result[match[1]!] = match[2]!
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/, '').trim())
      .filter((line) => line && !line.startsWith('@@'));
  }
  return result;
}

export function parsePrismaSchema(text = readFileSync(SCHEMA_PATH, 'utf8')): PrismaSchema {
  const enums = Object.fromEntries(
    Object.entries(blocks(text, 'enum')).map(([name, lines]) => [
      name,
      lines.map((l) => l.split(/\s+/)[0]!),
    ]),
  );
  const models = Object.fromEntries(
    Object.entries(blocks(text, 'model')).map(([name, lines]) => [
      name,
      lines.map((line) => {
        const [fieldName, rawType] = line.split(/\s+/) as [string, string];
        return {
          name: fieldName,
          type: rawType.replace(/[?[\]]/g, ''),
          optional: rawType.endsWith('?'),
          list: rawType.endsWith('[]'),
        };
      }),
    ]),
  );
  return { enums, models };
}

/** Campos escalares (incluye enums), sin relaciones. */
export function scalarFields(schema: PrismaSchema, model: string): PrismaField[] {
  return (schema.models[model] ?? []).filter((f) => SCALARS.has(f.type) || f.type in schema.enums);
}
