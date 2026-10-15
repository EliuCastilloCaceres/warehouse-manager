import {
  type CartCreateInput,
  type CartDetailDto,
  type CartItemAddInput,
  type CartItemUpdateInput,
  type CartListQuery,
  type CartSummaryDto,
  type CartSuspendInput,
  type CartUpdateInput,
  computeSaleTotals,
  MAX_SUSPENDED_CARTS_PER_USER,
  type ReleaseTo,
  variantLabel,
} from '@warehouse-manager/shared';
import type { FastifyInstance } from 'fastify';
import { DomainError, validationError } from '../../core/errors.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { assertInBranch, assertPermission, type PosActor, userRef } from './pos.actor.js';
import * as repo from './pos.repository.js';
import type { CartDetailRow } from './pos.repository.js';

type Tx = Prisma.TransactionClient;
type TaxSettings = { taxRateBp: number; pricesIncludeTax: boolean };

const lineAmount = (item: { unitPrice: number; quantity: number }) =>
  item.unitPrice * item.quantity;

/** Σ de las partidas ya descontadas: el tope del descuento global. */
const netOfLines = (items: { unitPrice: number; quantity: number; discount: number }[]) =>
  items.reduce((sum, item) => sum + lineAmount(item) - item.discount, 0);

function totalsOf(
  items: { unitPrice: number; quantity: number; discount: number }[],
  globalDiscount: number,
  tax: TaxSettings,
) {
  return computeSaleTotals({
    lines: items.map(({ unitPrice, quantity, discount }) => ({ unitPrice, quantity, discount })),
    globalDiscount,
    taxRateBp: tax.taxRateBp,
    pricesIncludeTax: tax.pricesIncludeTax,
  });
}

function toCartDetail(row: CartDetailRow, tax: TaxSettings): CartDetailDto {
  return {
    id: row.id,
    branchId: row.branchId,
    userId: row.userId,
    number: row.number,
    status: row.status,
    label: row.label,
    customerName: row.customerName,
    discount: row.discount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    owner: userRef(row.user),
    items: row.items.map((item) => ({
      id: item.id,
      cartId: item.cartId,
      variantId: item.variantId,
      sourceRackId: item.sourceRackId,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      discount: item.discount,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
      sku: item.variant.sku,
      barcode: item.variant.barcode,
      productName: item.variant.product.name,
      variantLabel: variantLabel(item.variant),
      thumbUrl: (item.variant.images[0] ?? item.variant.product.images[0])?.thumbUrl ?? null,
      locationCode: item.sourceRack.locationCode,
      isStaging: item.sourceRack.container.zone.isStaging,
      lineTotal: lineAmount(item) - item.discount,
    })),
    totals: { ...totalsOf(row.items, row.discount, tax), ...tax },
  };
}

const ownerOnly = (action: string) =>
  new DomainError('FORBIDDEN', { message: `Solo quien armó el carrito puede ${action}.` });

const cartNotFound = () =>
  new DomainError('NOT_FOUND', { message: 'No se encontró el producto en el carrito.' });

/** Carritos de la sucursal y sus partidas (spec F8 §3). Toda reserva pasa por `InventoryService`. */
export class CartsService {
  private readonly inventory = new InventoryService();

  constructor(private readonly app: FastifyInstance) {}

  private get prisma() {
    return this.app.prisma;
  }

  private tax(branchId: string): Promise<TaxSettings> {
    return repo.taxSettingsOf(this.prisma, branchId);
  }

  /** Carrito bloqueado (`FOR UPDATE`) de la sucursal del actor. */
  private async lockedCart(tx: Tx, actor: PosActor, id: string) {
    await repo.lockCart(tx, id);
    const cart = await tx.cart.findUnique({ where: { id } });
    assertInBranch(actor, cart);
    return cart;
  }

  private async editableCart(tx: Tx, actor: PosActor, id: string) {
    const cart = await this.lockedCart(tx, actor, id);
    if (!repo.OPEN_CART_STATUSES.includes(cart.status)) {
      throw new DomainError('CART_NOT_EDITABLE');
    }
    return cart;
  }

  /** Serializa lo que cambia los carritos de un vendedor (activo y suspendidos). */
  private ownerLock(tx: Tx, branchId: string, userId: string) {
    return repo.advisoryLock(tx, `pos.cart.owner:${branchId}:${userId}`);
  }

  /** Pasa el carrito a `SUSPENDED` si el vendedor no llegó al límite (con `ownerLock` tomado). */
  private async suspendWithinLimit(
    tx: Tx,
    cart: { id: string; branchId: string; userId: string },
    data: Prisma.CartUpdateInput = {},
  ) {
    const suspended = await tx.cart.count({
      where: { branchId: cart.branchId, userId: cart.userId, status: 'SUSPENDED' },
    });
    if (suspended >= MAX_SUSPENDED_CARTS_PER_USER) throw new DomainError('CART_LIMIT_REACHED');
    await tx.cart.update({ where: { id: cart.id }, data: { ...data, status: 'SUSPENDED' } });
  }

  /**
   * Libera unidades reservadas de una partida: a su ubicación (`RETURN_TO_RACK`) o a staging
   * (`TO_STAGING`). Una partida tomada de staging se libera en su lugar (decisión 2026-10-15).
   */
  private async releaseItem(
    tx: Tx,
    actor: PosActor,
    item: { cartId: string; variantId: string; sourceRackId: string; isStaging: boolean },
    quantity: number,
    releaseTo: ReleaseTo,
  ) {
    const common = {
      variantId: item.variantId,
      quantity,
      userId: actor.userId,
      reference: { type: 'CART' as const, id: item.cartId },
    };
    if (releaseTo === 'STAGING' && !item.isStaging) {
      await this.inventory.moveReservedToStaging(tx, { ...common, fromRackId: item.sourceRackId });
    } else {
      await this.inventory.release(tx, { ...common, rackId: item.sourceRackId });
    }
  }

  private async releaseCartItems(tx: Tx, actor: PosActor, cartId: string, releaseTo: ReleaseTo) {
    const items = await tx.cartItem.findMany({
      where: { cartId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: { sourceRack: { select: { container: { select: { zone: true } } } } },
    });
    for (const item of items) {
      await this.releaseItem(
        tx,
        actor,
        { ...item, isStaging: item.sourceRack.container.zone.isStaging },
        item.quantity,
        releaseTo,
      );
    }
    return items.reduce((sum, item) => sum + item.quantity, 0);
  }

  /** Si las partidas bajaron, el descuento global se recorta a su nuevo importe. */
  private async clipGlobalDiscount(tx: Tx, cartId: string) {
    const cart = await tx.cart.findUniqueOrThrow({
      where: { id: cartId },
      include: { items: true },
    });
    const max = netOfLines(cart.items);
    if (cart.discount > max) {
      await tx.cart.update({ where: { id: cartId }, data: { discount: max } });
    }
  }

  async detail(actor: PosActor, id: string): Promise<CartDetailDto> {
    const row = await repo.findCartDetail(this.prisma, id);
    assertInBranch(actor, row);
    return toCartDetail(row, await this.tax(actor.branchId));
  }

  /** Carritos `ACTIVE` y `SUSPENDED` de la sucursal (o solo los propios), por número. */
  async list(actor: PosActor, query: CartListQuery): Promise<CartSummaryDto[]> {
    const [carts, tax] = await Promise.all([
      this.prisma.cart.findMany({
        where: {
          branchId: actor.branchId,
          status: { in: repo.OPEN_CART_STATUSES },
          ...(query.scope === 'mine' ? { userId: actor.userId } : {}),
          ...(query.number !== undefined ? { number: query.number } : {}),
        },
        orderBy: { number: 'asc' },
        include: {
          user: { select: { id: true, fullName: true } },
          items: { select: { unitPrice: true, quantity: true, discount: true } },
        },
      }),
      this.tax(actor.branchId),
    ]);
    return carts.map(({ user, items, ...cart }) => ({
      ...cart,
      createdAt: cart.createdAt.toISOString(),
      updatedAt: cart.updatedAt.toISOString(),
      owner: userRef(user),
      itemCount: items.length,
      unitCount: items.reduce((sum, item) => sum + item.quantity, 0),
      total: totalsOf(items, cart.discount, tax).total,
    }));
  }

  /**
   * Carrito nuevo del actor: reutiliza su activo vacío (`created: false`); si el activo tiene
   * partidas, lo suspende (con el límite) y crea otro con el menor número libre.
   */
  async create(
    actor: PosActor,
    input: CartCreateInput,
  ): Promise<{ created: boolean; cart: CartDetailDto }> {
    const names = {
      ...(input.label !== undefined ? { label: input.label } : {}),
      ...(input.customerName !== undefined ? { customerName: input.customerName } : {}),
    };
    const { created, id } = await this.prisma.$transaction(async (tx) => {
      await repo.lockBranch(tx, actor.branchId, 'SHARE');
      await repo.assertOpenSessionInBranch(tx, actor.branchId);
      await this.ownerLock(tx, actor.branchId, actor.userId);
      const active = await tx.cart.findFirst({
        where: { branchId: actor.branchId, userId: actor.userId, status: 'ACTIVE' },
        include: { _count: { select: { items: true } } },
      });
      if (active) {
        await repo.lockCart(tx, active.id);
        if (active._count.items === 0) {
          if (Object.keys(names).length > 0) {
            await tx.cart.update({ where: { id: active.id }, data: names });
          }
          return { created: false, id: active.id };
        }
        await this.suspendWithinLimit(tx, active);
      }
      const cart = await tx.cart.create({
        data: {
          branchId: actor.branchId,
          userId: actor.userId,
          number: await repo.nextCartNumber(tx, actor.branchId),
          ...names,
        },
      });
      return { created: true, id: cart.id };
    });
    return { created, cart: await this.detail(actor, id) };
  }

  async update(actor: PosActor, id: string, input: CartUpdateInput): Promise<CartDetailDto> {
    if (input.discount !== undefined) assertPermission(actor, 'pos.discount');
    await this.prisma.$transaction(async (tx) => {
      await this.editableCart(tx, actor, id);
      if (input.discount !== undefined) {
        const items = await tx.cartItem.findMany({ where: { cartId: id } });
        if (input.discount > netOfLines(items)) {
          throw validationError('discount', 'El descuento no puede superar el importe del carrito');
        }
      }
      await tx.cart.update({ where: { id }, data: input });
    });
    return this.detail(actor, id);
  }

  /** Solo el dueño suspende; las reservas se conservan. */
  async suspend(actor: PosActor, id: string, input: CartSuspendInput): Promise<CartDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      await this.ownerLock(tx, actor.branchId, actor.userId);
      const cart = await this.editableCart(tx, actor, id);
      if (cart.userId !== actor.userId) throw ownerOnly('suspenderlo');
      if ((await tx.cartItem.count({ where: { cartId: id } })) === 0) {
        throw new DomainError('CART_EMPTY');
      }
      const names = {
        ...(input.label !== undefined ? { label: input.label } : {}),
        ...(input.customerName !== undefined ? { customerName: input.customerName } : {}),
      };
      if (cart.status === 'ACTIVE') {
        await this.suspendWithinLimit(tx, cart, names);
      } else if (Object.keys(names).length > 0) {
        await tx.cart.update({ where: { id }, data: names });
      }
    });
    return this.detail(actor, id);
  }

  /** Solo el dueño retoma: su activo pasa a suspendido (o se descarta si está vacío). */
  async resume(actor: PosActor, id: string): Promise<CartDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      await this.ownerLock(tx, actor.branchId, actor.userId);
      const cart = await this.editableCart(tx, actor, id);
      if (cart.userId !== actor.userId) throw ownerOnly('retomarlo');
      if (cart.status === 'ACTIVE') return;
      const current = await tx.cart.findFirst({
        where: { branchId: cart.branchId, userId: cart.userId, status: 'ACTIVE' },
        select: { id: true },
      });
      if (current) {
        await repo.lockCart(tx, current.id);
        const items = await tx.cartItem.count({ where: { cartId: current.id } });
        await tx.cart.update({
          where: { id: current.id },
          data: { status: items > 0 ? 'SUSPENDED' : 'DISCARDED' },
        });
      }
      await tx.cart.update({ where: { id }, data: { status: 'ACTIVE' } });
    });
    return this.detail(actor, id);
  }

  /** Libera todas las partidas con la misma acción y deja el carrito `DISCARDED`. */
  async discard(actor: PosActor, id: string, releaseTo: ReleaseTo): Promise<CartDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      await this.editableCart(tx, actor, id);
      await this.releaseCartItems(tx, actor, id, releaseTo);
      await tx.cart.update({ where: { id }, data: { status: 'DISCARDED' } });
    });
    return this.detail(actor, id);
  }

  /** Descarta los carritos pendientes (con partidas) de la sucursal y libera sus reservas. */
  async releaseAll(actor: PosActor, releaseTo: ReleaseTo): Promise<{ releasedCarts: number }> {
    return this.prisma.$transaction(async (tx) => {
      await repo.lockBranch(tx, actor.branchId, 'UPDATE');
      const open = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM cart
        WHERE branch_id = ${actor.branchId}::uuid AND status IN ('ACTIVE', 'SUSPENDED')
        ORDER BY number
        FOR UPDATE`;
      const released: { id: string; units: number }[] = [];
      for (const { id } of open) {
        const units = await this.releaseCartItems(tx, actor, id, releaseTo);
        if (units === 0) continue;
        await tx.cart.update({ where: { id }, data: { status: 'DISCARDED' } });
        released.push({ id, units });
      }
      if (released.length > 0) {
        await this.app.audit.record(
          {
            userId: actor.userId,
            action: 'pos.carts.release_all',
            entity: 'Branch',
            entityId: actor.branchId,
            payload: { releaseTo, carts: released },
            ip: actor.ip,
          },
          tx,
        );
      }
      return { releasedCarts: released.length };
    });
  }

  /**
   * Agrega una partida desde un rack de la sucursal y reserva sus unidades (`PICK`). La misma
   * variante del mismo rack se suma a la partida existente, con su precio original.
   */
  async addItem(actor: PosActor, id: string, input: CartItemAddInput): Promise<CartDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      await repo.lockBranch(tx, actor.branchId, 'SHARE');
      await repo.assertOpenSessionInBranch(tx, actor.branchId);
      const cart = await this.editableCart(tx, actor, id);
      const variant = await tx.productVariant.findUnique({
        where: { id: input.variantId },
        include: { product: { select: { price: true, isActive: true } } },
      });
      if (!variant) throw new DomainError('NOT_FOUND', { message: 'No se encontró el producto.' });
      if (!variant.isActive || !variant.product.isActive) {
        throw new DomainError('VARIANT_INACTIVE');
      }
      const rack = await tx.rack.findUnique({
        where: { id: input.sourceRackId },
        select: { warehouse: { select: { branchId: true } } },
      });
      if (rack?.warehouse.branchId !== cart.branchId) {
        throw validationError('sourceRackId', 'La ubicación no es de esta sucursal');
      }
      await this.inventory.pick(tx, {
        variantId: variant.id,
        rackId: input.sourceRackId,
        quantity: input.quantity,
        userId: actor.userId,
        reference: { type: 'CART', id },
      });
      const existing = await tx.cartItem.findFirst({
        where: { cartId: id, variantId: variant.id, sourceRackId: input.sourceRackId },
      });
      if (existing) {
        await tx.cartItem.update({
          where: { id: existing.id },
          data: { quantity: existing.quantity + input.quantity },
        });
      } else {
        await tx.cartItem.create({
          data: {
            cartId: id,
            variantId: variant.id,
            sourceRackId: input.sourceRackId,
            quantity: input.quantity,
            unitPrice: variant.priceOverride ?? variant.product.price,
          },
        });
      }
    });
    return this.detail(actor, id);
  }

  /**
   * Cambia la cantidad (sube: `PICK` de la diferencia, con caja abierta; baja: libera según
   * `releaseTo`) o el descuento de una partida. Los descuentos se recortan al nuevo importe.
   */
  async updateItem(
    actor: PosActor,
    id: string,
    itemId: string,
    input: CartItemUpdateInput,
  ): Promise<CartDetailDto> {
    if (input.discount !== undefined) assertPermission(actor, 'pos.discount');
    await this.prisma.$transaction(async (tx) => {
      if (input.quantity !== undefined) await repo.lockBranch(tx, actor.branchId, 'SHARE');
      await this.editableCart(tx, actor, id);
      const item = await repo.findCartItem(tx, itemId);
      if (!item || item.cartId !== id) throw cartNotFound();

      const quantity = input.quantity ?? item.quantity;
      if (quantity > item.quantity) {
        await repo.assertOpenSessionInBranch(tx, actor.branchId);
        await this.inventory.pick(tx, {
          variantId: item.variantId,
          rackId: item.sourceRackId,
          quantity: quantity - item.quantity,
          userId: actor.userId,
          reference: { type: 'CART', id },
        });
      } else if (quantity < item.quantity) {
        await this.releaseItem(
          tx,
          actor,
          { ...item, isStaging: item.sourceRack.container.zone.isStaging },
          item.quantity - quantity,
          input.releaseTo,
        );
      }

      const amount = item.unitPrice * quantity;
      if (input.discount !== undefined && input.discount > amount) {
        throw validationError('discount', 'El descuento no puede superar el importe de la partida');
      }
      const discount = Math.min(input.discount ?? item.discount, amount);
      await tx.cartItem.update({ where: { id: itemId }, data: { quantity, discount } });
      await this.clipGlobalDiscount(tx, id);
    });
    return this.detail(actor, id);
  }

  /** Quita la partida completa y libera sus unidades según `releaseTo`. */
  async removeItem(
    actor: PosActor,
    id: string,
    itemId: string,
    releaseTo: ReleaseTo,
  ): Promise<CartDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      await this.editableCart(tx, actor, id);
      const item = await repo.findCartItem(tx, itemId);
      if (!item || item.cartId !== id) throw cartNotFound();
      await this.releaseItem(
        tx,
        actor,
        { ...item, isStaging: item.sourceRack.container.zone.isStaging },
        item.quantity,
        releaseTo,
      );
      await tx.cartItem.delete({ where: { id: itemId } });
      await this.clipGlobalDiscount(tx, id);
    });
    return this.detail(actor, id);
  }
}
