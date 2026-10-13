import {
  IMPORT_MAX_BYTES,
  ImportCommitInput,
  ImportParseDto,
  ImportSummary,
  ImportValidateInput,
  ImportValidationDto,
} from '@warehouse-manager/shared';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { DomainError, validationError } from '../../core/errors.js';
import { listCatalogs } from './catalogs.js';
import { type ImportActor, ImportService } from './import.service.js';
import { buildTemplate, parseWorkbook, XLSX_MIME } from './xlsx.js';

const ACCESS = { access: { permission: 'products.import' } } as const;
/** 2 000 filas de 15 columnas en JSON pueden pasar del límite por defecto (1 MiB). */
const ROWS_BODY_LIMIT = 10 * 1024 * 1024;

function importActorOf(request: FastifyRequest): ImportActor {
  const auth = request.auth!;
  return { userId: auth.userId, permissions: auth.permissions, ip: request.ip };
}

/** `/products/import`: plantilla, lectura del `.xlsx`, validación y aplicación (spec F6 §6). */
export const productImportRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = new ImportService(app);
  const tags = ['products'];

  app.get(
    '/import/template',
    {
      config: ACCESS,
      schema: { tags, summary: 'Plantilla .xlsx de la carga masiva', produces: [XLSX_MIME] },
    },
    async (_request, reply) => {
      const catalogs = await listCatalogs(app.prisma);
      const file = await buildTemplate({
        categories: catalogs.categories.map((c) => c.path),
        brands: catalogs.brands.map((b) => b.name),
      });
      return reply
        .header('content-type', XLSX_MIME)
        .header('content-disposition', 'attachment; filename="plantilla-productos.xlsx"')
        .send(file);
    },
  );

  app.post(
    '/import/parse',
    {
      config: ACCESS,
      schema: {
        tags,
        summary: 'Leer un .xlsx (hasta 5 MiB y 2 000 filas) y devolver sus filas',
        consumes: ['multipart/form-data'],
        response: { 200: ImportParseDto },
      },
    },
    async (request) => {
      const file = await request.file({ limits: { fileSize: IMPORT_MAX_BYTES } });
      if (!file || file.fieldname !== 'file') throw validationError('file', 'Falta el archivo');
      const isXlsx = file.mimetype === XLSX_MIME || file.filename.toLowerCase().endsWith('.xlsx');
      if (!isXlsx) {
        throw new DomainError('UNSUPPORTED_MEDIA_TYPE', { message: 'Sube un archivo .xlsx.' });
      }
      const buffer = await file.toBuffer(); // > 5 MiB → 413 PAYLOAD_TOO_LARGE
      return { rows: await parseWorkbook(buffer) };
    },
  );

  app.post(
    '/import/validate',
    {
      config: { ...ACCESS, branchScoped: true },
      bodyLimit: ROWS_BODY_LIMIT,
      schema: {
        tags,
        summary: 'Validar las filas contra la BD, sin escribir',
        body: ImportValidateInput,
        response: { 200: ImportValidationDto },
      },
    },
    async (request) => service.validate(request.body, importActorOf(request), request.branchId!),
  );

  app.post(
    '/import/commit',
    {
      config: { ...ACCESS, branchScoped: true },
      bodyLimit: ROWS_BODY_LIMIT,
      schema: {
        tags,
        summary: 'Aplicar la carga (todo o nada)',
        body: ImportCommitInput,
        response: { 200: ImportSummary },
      },
    },
    async (request) => service.commit(request.body, importActorOf(request), request.branchId!),
  );
};
