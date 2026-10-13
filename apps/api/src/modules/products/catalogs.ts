import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';

type Db = PrismaClient | Prisma.TransactionClient;

export const CATEGORY_SEPARATOR = ' > ';

/** Ruta de cada categoría (`Calzado > Dama`), armada con sus ancestros. */
export async function categoryPaths(db: Db): Promise<Map<string, string>> {
  const rows = await db.category.findMany({ select: { id: true, name: true, parentId: true } });
  const byId = new Map(rows.map((row) => [row.id, row]));
  const paths = new Map<string, string>();
  const pathOf = (id: string): string => {
    const cached = paths.get(id);
    if (cached) return cached;
    const row = byId.get(id)!;
    const path = row.parentId
      ? `${pathOf(row.parentId)}${CATEGORY_SEPARATOR}${row.name}`
      : row.name;
    paths.set(id, path);
    return path;
  };
  for (const row of rows) pathOf(row.id);
  return paths;
}

/** Categoría de una ruta, comparando cada nivel sin distinguir mayúsculas; `null` si falta alguno. */
export async function findCategory(db: Db, path: string): Promise<string | null> {
  let parentId: string | null = null;
  for (const name of path.split(CATEGORY_SEPARATOR)) {
    const row: { id: string } | null = await db.category.findFirst({
      where: { parentId, name: { equals: name, mode: 'insensitive' } },
      select: { id: true },
    });
    if (!row) return null;
    parentId = row.id;
  }
  return parentId;
}

/** Categoría de una ruta; crea los niveles que falten (spec F6 §3). */
export async function resolveCategory(tx: Prisma.TransactionClient, path: string): Promise<string> {
  let parentId: string | null = null;
  for (const name of path.split(CATEGORY_SEPARATOR)) {
    const row: { id: string } | null = await tx.category.findFirst({
      where: { parentId, name: { equals: name, mode: 'insensitive' } },
      select: { id: true },
    });
    parentId = row ? row.id : (await tx.category.create({ data: { name, parentId } })).id;
  }
  return parentId!;
}

export async function findBrand(db: Db, name: string): Promise<string | null> {
  const row = await db.brand.findFirst({
    where: { name: { equals: name, mode: 'insensitive' } },
    select: { id: true },
  });
  return row?.id ?? null;
}

/** Marca por nombre (sin distinguir mayúsculas); la crea si no existe. */
export async function resolveBrand(tx: Prisma.TransactionClient, name: string): Promise<string> {
  return (await findBrand(tx, name)) ?? (await tx.brand.create({ data: { name } })).id;
}

/** Rutas de categoría y marcas para autocompletar (`GET /products/catalogs`). */
export async function listCatalogs(db: Db) {
  const [paths, brands] = await Promise.all([
    categoryPaths(db),
    db.brand.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
  ]);
  const categories = [...paths.entries()]
    .map(([id, path]) => ({ id, path }))
    .sort((a, b) => a.path.localeCompare(b.path, 'es'));
  return { categories, brands };
}
