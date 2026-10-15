import {
  CartCreateInput,
  CartDetailDto,
  CartDiscardInput,
  CartItemAddInput,
  CartItemRemoveQuery,
  CartItemUpdateInput,
  CartListQuery,
  CartSummaryDto,
  CartSuspendInput,
  CartUpdateInput,
  CheckoutInput,
  ReleaseCartsInput,
  ReleaseCartsResultDto,
  SaleTicketDto,
  Uuid,
} from '@warehouse-manager/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { CartsService } from './carts.service.js';
import { CheckoutService } from './checkout.service.js';
import { posActorOf } from './pos.actor.js';

const IdParams = z.object({ id: Uuid });
const ItemParams = z.object({ id: Uuid, itemId: Uuid });
const SELL = { access: { permission: 'pos.sell' }, branchScoped: true } as const;
const tags = ['pos'];

/** Carritos, partidas y cobro (spec F8 §6). */
export const posCartsRoutes: FastifyPluginAsyncZod = async (app) => {
  const carts = new CartsService(app);
  const checkout = new CheckoutService(app);

  app.get(
    '/carts',
    {
      config: SELL,
      schema: {
        tags,
        summary: 'Carritos abiertos de la sucursal (propios o de todos)',
        querystring: CartListQuery,
        response: { 200: z.array(CartSummaryDto) },
      },
    },
    async (request) => carts.list(posActorOf(request), request.query),
  );

  app.post(
    '/carts',
    {
      config: SELL,
      schema: {
        tags,
        summary: 'Carrito nuevo (reutiliza el activo vacío)',
        body: CartCreateInput,
        response: { 200: CartDetailDto, 201: CartDetailDto },
      },
    },
    async (request, reply) => {
      const { created, cart } = await carts.create(posActorOf(request), request.body);
      reply.code(created ? 201 : 200);
      return cart;
    },
  );

  app.post(
    '/carts/release-all',
    {
      config: { access: { permission: 'pos.session.close' }, branchScoped: true },
      schema: {
        tags,
        summary: 'Descartar los carritos pendientes de la sucursal y liberar sus reservas',
        body: ReleaseCartsInput,
        response: { 200: ReleaseCartsResultDto },
      },
    },
    async (request) => carts.releaseAll(posActorOf(request), request.body.releaseTo),
  );

  app.get(
    '/carts/:id',
    {
      config: SELL,
      schema: {
        tags,
        summary: 'Detalle de un carrito',
        params: IdParams,
        response: { 200: CartDetailDto },
      },
    },
    async (request) => carts.detail(posActorOf(request), request.params.id),
  );

  app.patch(
    '/carts/:id',
    {
      config: SELL,
      schema: {
        tags,
        summary: 'Etiqueta, cliente o descuento global (este con pos.discount)',
        params: IdParams,
        body: CartUpdateInput,
        response: { 200: CartDetailDto },
      },
    },
    async (request) => carts.update(posActorOf(request), request.params.id, request.body),
  );

  app.post(
    '/carts/:id/suspend',
    {
      config: SELL,
      schema: {
        tags,
        summary: 'Suspender el carrito (solo su dueño)',
        params: IdParams,
        body: CartSuspendInput,
        response: { 200: CartDetailDto },
      },
    },
    async (request) => carts.suspend(posActorOf(request), request.params.id, request.body),
  );

  app.post(
    '/carts/:id/resume',
    {
      config: SELL,
      schema: {
        tags,
        summary: 'Retomar un carrito suspendido (solo su dueño)',
        params: IdParams,
        response: { 200: CartDetailDto },
      },
    },
    async (request) => carts.resume(posActorOf(request), request.params.id),
  );

  app.post(
    '/carts/:id/discard',
    {
      config: SELL,
      schema: {
        tags,
        summary: 'Descartar el carrito y liberar sus reservas',
        params: IdParams,
        body: CartDiscardInput,
        response: { 200: CartDetailDto },
      },
    },
    async (request) =>
      carts.discard(posActorOf(request), request.params.id, request.body.releaseTo),
  );

  app.post(
    '/carts/:id/items',
    {
      config: SELL,
      schema: {
        tags,
        summary: 'Agregar un producto desde un rack (reserva las unidades)',
        params: IdParams,
        body: CartItemAddInput,
        response: { 201: CartDetailDto },
      },
    },
    async (request, reply) => {
      reply.code(201);
      return carts.addItem(posActorOf(request), request.params.id, request.body);
    },
  );

  app.patch(
    '/carts/:id/items/:itemId',
    {
      config: SELL,
      schema: {
        tags,
        summary: 'Cambiar la cantidad o el descuento de una partida',
        params: ItemParams,
        body: CartItemUpdateInput,
        response: { 200: CartDetailDto },
      },
    },
    async (request) =>
      carts.updateItem(posActorOf(request), request.params.id, request.params.itemId, request.body),
  );

  app.delete(
    '/carts/:id/items/:itemId',
    {
      config: SELL,
      schema: {
        tags,
        summary: 'Quitar una partida (a su ubicación o a staging)',
        params: ItemParams,
        querystring: CartItemRemoveQuery,
        response: { 200: CartDetailDto },
      },
    },
    async (request) =>
      carts.removeItem(
        posActorOf(request),
        request.params.id,
        request.params.itemId,
        request.query.releaseTo,
      ),
  );

  app.post(
    '/carts/:id/checkout',
    {
      config: SELL,
      schema: {
        tags,
        summary: 'Cobrar el carrito en la caja del dispositivo',
        params: IdParams,
        body: CheckoutInput,
        response: { 201: SaleTicketDto },
      },
    },
    async (request, reply) => {
      const ticket = await checkout.checkout(posActorOf(request), request.params.id, request.body);
      reply.code(201);
      return ticket;
    },
  );
};
