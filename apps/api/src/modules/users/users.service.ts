import {
  isAssignableRole,
  isWithinScope,
  missingPermissions,
  PERMISSION_MODULES,
  PERMISSIONS,
  suggestUsernameBase,
  SYSTEM_ROLES,
  type PasswordInput,
  type PasswordResetResultDto,
  type PermissionCode,
  type PermissionGroupDto,
  type RoleWithPermissionsDto,
  type UserCreatedDto,
  type UserCreateInput,
  type UserDetailDto,
  type UserListItemDto,
  type UserListQuery,
  type UsernameSuggestionDto,
  type UserUpdateInput,
} from '@warehouse-manager/shared';
import type { FastifyInstance } from 'fastify';
import { DomainError, validationError } from '../../core/errors.js';
import { buildPage, containsInsensitive, toOrderBy, toPrismaPage } from '../../core/pagination.js';
import { generateReadablePassword, hashPassword } from '../../core/password.js';
import { Prisma } from '../../generated/prisma/client.js';
import { effectivePermissions } from '../auth/permissions.js';
import * as repo from './users.repository.js';
import type { RoleRow, UserRow } from './users.repository.js';

const OWNER_ROLE = 'OWNER';
const USERNAME_MAX = 30;

/** Quien actúa: datos de sus claims (spec F2 §2) y la ip para el audit. */
export interface Actor {
  userId: string;
  permissions: readonly PermissionCode[];
  branchIds: readonly string[];
  ip: string | null;
}

type Page<T> = { items: T[]; page: number; pageSize: number; total: number };

const codesOf = (links: { permission: { code: string } }[]) =>
  links.map((link) => link.permission.code);

const rolePermissions = (role: Pick<RoleRow, 'permissions'>) =>
  effectivePermissions(codesOf(role.permissions));

const extraPermissionsOf = (user: UserRow) => effectivePermissions(codesOf(user.permissions));

const effectivePermissionsOf = (user: UserRow) =>
  effectivePermissions(codesOf(user.role.permissions), codesOf(user.permissions));

/** Extras sin los que ya da el rol (spec F4 §3). */
const withoutRolePermissions = (extras: readonly PermissionCode[], rolePerms: PermissionCode[]) =>
  extras.filter((code) => !rolePerms.includes(code)).sort();

function sameList(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const sorted = [...b].sort();
  return [...a].sort().every((value, i) => value === sorted[i]);
}

function toListItem(row: UserRow): UserListItemDto {
  return {
    id: row.id,
    username: row.username,
    fullName: row.fullName,
    email: row.email,
    phone: row.phone,
    roleId: row.roleId,
    type: row.type,
    isActive: row.isActive,
    mustChangePassword: row.mustChangePassword,
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    role: { id: row.role.id, code: row.role.code, name: row.role.name },
    branches: row.branches
      .map((ub) => ({ ...ub.branch, isDefault: ub.isDefault }))
      .sort((a, b) => a.code.localeCompare(b.code)),
  };
}

function toDetail(row: UserRow): UserDetailDto {
  return {
    ...toListItem(row),
    extraPermissions: extraPermissionsOf(row),
    effectivePermissions: effectivePermissionsOf(row),
  };
}

/** Contraseña en claro a guardar y la que se devuelve (solo si se generó). */
function resolvePassword(input: PasswordInput): { password: string; generated: string | null } {
  if (input.mode === 'manual') return { password: input.value, generated: null };
  const generated = generateReadablePassword();
  return { password: generated, generated };
}

const usernameConflict = () =>
  new DomainError('CONFLICT', {
    message: 'Este usuario ya existe.',
    details: { target: ['username'] },
  });

const inactiveBranches = () =>
  validationError('branchIds', 'Alguna sucursal no existe o está inactiva');

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

/** Usuarios, roles y catálogo de permisos (spec F4). */
export class UsersService {
  constructor(private readonly app: FastifyInstance) {}

  private get prisma() {
    return this.app.prisma;
  }

  async list(query: UserListQuery): Promise<Page<UserListItemDto>> {
    const text = containsInsensitive(query.q);
    const where: Prisma.UserWhereInput = {
      isActive: query.isActive,
      roleId: query.roleId,
      branches: query.branchId ? { some: { branchId: query.branchId } } : undefined,
      OR: text ? [{ username: text }, { fullName: text }, { email: text }] : undefined,
    };
    const orderBy = [toOrderBy(query.sort, { field: 'fullName', direction: 'asc' }), { id: 'asc' }];
    const [total, rows] = await repo.listUserRows(
      this.prisma,
      where,
      orderBy as Prisma.UserOrderByWithRelationInput[],
      toPrismaPage(query),
    );
    return buildPage(rows.map(toListItem), total, query);
  }

  async get(id: string): Promise<UserDetailDto> {
    return toDetail(await this.loadTarget(id));
  }

  /** Roles en el orden del sistema, con `assignable` según el actor. */
  async roles(actor: Pick<Actor, 'permissions'>): Promise<RoleWithPermissionsDto[]> {
    const order: string[] = SYSTEM_ROLES.map((role) => role.code);
    const rank = (code: string) => (order.includes(code) ? order.indexOf(code) : order.length);
    const rows = await repo.findRoles(this.prisma);
    return rows
      .sort((a, b) => rank(a.code) - rank(b.code) || a.name.localeCompare(b.name))
      .map((row) => {
        const permissions = rolePermissions(row);
        return {
          id: row.id,
          code: row.code,
          name: row.name,
          isSystem: row.isSystem,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
          permissions,
          assignable: isAssignableRole(row.code, permissions, actor.permissions),
        };
      });
  }

  /** Catálogo agrupado por módulo, en el orden de `shared`. */
  permissions(): PermissionGroupDto[] {
    return PERMISSION_MODULES.map((module) => ({
      module,
      permissions: PERMISSIONS.filter((p) => p.module === module).map(({ code, description }) => ({
        code,
        description,
      })),
    }));
  }

  /** Base sugerida + el primer sufijo libre (`jperez`, `jperez2`…), sin pasar de 30. */
  async suggestUsername(fullName: string): Promise<UsernameSuggestionDto> {
    const base = suggestUsernameBase(fullName);
    if (!base) return { username: null };
    for (let n = 1; ; n++) {
      const suffix = n === 1 ? '' : String(n);
      const candidate = `${base.slice(0, USERNAME_MAX - suffix.length)}${suffix}`;
      if (!(await repo.usernameExists(this.prisma, candidate))) return { username: candidate };
    }
  }

  async create(actor: Actor, input: UserCreateInput): Promise<UserCreatedDto> {
    const role = await repo.findRoleById(this.prisma, input.roleId);
    if (role?.code === OWNER_ROLE) throw new DomainError('USER_OWNER_PROTECTED');
    if (input.extraPermissions.length > 0) this.assertCanGrantExtras(actor);
    this.assertNoEscalation(actor, [
      ...(role ? rolePermissions(role) : []),
      ...input.extraPermissions,
    ]);
    const active = await this.assertBranchesGrantable(actor, input.branchIds);
    if (!role) throw validationError('roleId', 'El rol no existe');
    if (active.size !== input.branchIds.length) throw inactiveBranches();
    if (await repo.usernameExists(this.prisma, input.username)) throw usernameConflict();

    const { password, generated } = resolvePassword(input.password);
    const passwordHash = await hashPassword(password);
    const extras = withoutRolePermissions(input.extraPermissions, rolePermissions(role));
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const row = await repo.createUserRow(
          tx,
          {
            username: input.username,
            fullName: input.fullName,
            email: input.email,
            phone: input.phone,
            roleId: role.id,
            passwordHash,
          },
          { ids: input.branchIds, defaultId: input.defaultBranchId },
          extras,
        );
        await this.app.audit.record(
          {
            userId: actor.userId,
            action: 'user.create',
            entity: 'User',
            entityId: row.id,
            payload: {
              roleCode: role.code,
              branchIds: input.branchIds,
              extraPermissions: extras,
              passwordMode: input.password.mode,
            },
            ip: actor.ip,
          },
          tx,
        );
        return row;
      });
      return { user: toDetail(row), generatedPassword: generated };
    } catch (error) {
      if (isUniqueViolation(error)) throw usernameConflict();
      throw error;
    }
  }

  async update(actor: Actor, id: string, input: UserUpdateInput): Promise<UserDetailDto> {
    const target = await this.loadTarget(id);
    const role =
      input.roleId === undefined ? null : await repo.findRoleById(this.prisma, input.roleId);
    const isSelf = actor.userId === target.id;
    if ((target.role.code === OWNER_ROLE && !isSelf) || role?.code === OWNER_ROLE) {
      throw new DomainError('USER_OWNER_PROTECTED');
    }
    const touchesAccess =
      input.roleId !== undefined ||
      input.extraPermissions !== undefined ||
      input.branchIds !== undefined ||
      input.defaultBranchId !== undefined;
    if (isSelf && touchesAccess) throw new DomainError('USER_SELF_CHANGE_FORBIDDEN');
    if (!isSelf) this.assertInScope(actor, target);
    if (input.extraPermissions !== undefined) this.assertCanGrantExtras(actor);
    this.assertNoEscalation(actor, [
      ...(role ? rolePermissions(role) : []),
      ...(input.extraPermissions ?? []),
    ]);
    if (input.branchIds) {
      const active = await this.assertBranchesGrantable(actor, input.branchIds);
      if (input.roleId !== undefined && !role) throw validationError('roleId', 'El rol no existe');
      if (active.size !== input.branchIds.length) throw inactiveBranches();
    } else if (input.roleId !== undefined && !role) {
      throw validationError('roleId', 'El rol no existe');
    }

    const currentBranchIds = target.branches.map((ub) => ub.branchId);
    const currentDefault = target.branches.find((ub) => ub.isDefault)?.branchId ?? null;
    if (
      !input.branchIds &&
      input.defaultBranchId !== undefined &&
      !currentBranchIds.includes(input.defaultBranchId)
    ) {
      throw validationError(
        'defaultBranchId',
        'La sucursal predeterminada debe estar entre las asignadas',
      );
    }

    const nextRole = role ?? target.role;
    const currentExtras = extraPermissionsOf(target);
    const nextExtras = withoutRolePermissions(
      input.extraPermissions ?? currentExtras,
      rolePermissions(nextRole),
    );
    const nextBranchIds = input.branchIds ?? currentBranchIds;
    const nextDefault = input.defaultBranchId ?? currentDefault;

    const changes: Record<string, { from: unknown; to: unknown }> = {};
    const scalars: Parameters<typeof repo.updateUserScalars>[2] = {};
    for (const field of ['fullName', 'email', 'phone'] as const) {
      const value = input[field];
      if (value !== undefined && value !== target[field]) {
        changes[field] = { from: target[field], to: value };
        (scalars as Record<string, unknown>)[field] = value;
      }
    }
    if (nextRole.id !== target.roleId) {
      changes.roleId = { from: target.roleId, to: nextRole.id };
      scalars.roleId = nextRole.id;
    }
    const branchesChanged = !sameList(nextBranchIds, currentBranchIds);
    if (branchesChanged) changes.branchIds = { from: currentBranchIds, to: nextBranchIds };
    if (nextDefault !== currentDefault) {
      changes.defaultBranchId = { from: currentDefault, to: nextDefault };
    }
    const extrasChanged = !sameList(nextExtras, currentExtras);
    if (extrasChanged) changes.extraPermissions = { from: currentExtras, to: nextExtras };

    if (Object.keys(changes).length === 0) return toDetail(target);

    const row = await this.prisma.$transaction(async (tx) => {
      await repo.updateUserScalars(tx, id, scalars);
      if (branchesChanged || nextDefault !== currentDefault) {
        await repo.replaceBranches(tx, id, nextBranchIds, nextDefault!);
      }
      if (extrasChanged) await repo.replaceExtraPermissions(tx, id, nextExtras);
      await this.app.audit.record(
        {
          userId: actor.userId,
          action: 'user.update',
          entity: 'User',
          entityId: id,
          payload: changes as Prisma.InputJsonObject,
          ip: actor.ip,
        },
        tx,
      );
      return repo.findUserRow(tx, id);
    });
    return toDetail(row!);
  }

  /** Desactiva y cierra sus sesiones; idempotente (spec F4 §3). */
  async deactivate(actor: Actor, id: string): Promise<UserDetailDto> {
    return this.setActive(actor, id, false);
  }

  async reactivate(actor: Actor, id: string): Promise<UserDetailDto> {
    return this.setActive(actor, id, true);
  }

  /** Nueva contraseña con cambio obligatorio; cierra todas sus sesiones. */
  async resetPassword(
    actor: Actor,
    id: string,
    input: PasswordInput,
  ): Promise<PasswordResetResultDto> {
    const target = await this.loadTarget(id);
    this.assertCanActOn(actor, target);
    const { password, generated } = resolvePassword(input);
    const passwordHash = await hashPassword(password);
    await this.prisma.$transaction(async (tx) => {
      await repo.setPassword(tx, id, passwordHash);
      await this.app.authService.revokeAllForUser(id, tx);
      await this.app.audit.record(
        {
          userId: actor.userId,
          action: 'user.password_reset',
          entity: 'User',
          entityId: id,
          payload: { passwordMode: input.mode },
          ip: actor.ip,
        },
        tx,
      );
    });
    return { generatedPassword: generated };
  }

  private async setActive(actor: Actor, id: string, isActive: boolean): Promise<UserDetailDto> {
    const target = await this.loadTarget(id);
    this.assertCanActOn(actor, target);
    if (target.isActive === isActive) return toDetail(target);
    const row = await this.prisma.$transaction(async (tx) => {
      await repo.setActive(tx, id, isActive);
      if (!isActive) await this.app.authService.revokeAllForUser(id, tx);
      await this.app.audit.record(
        {
          userId: actor.userId,
          action: isActive ? 'user.reactivate' : 'user.deactivate',
          entity: 'User',
          entityId: id,
          ip: actor.ip,
        },
        tx,
      );
      return repo.findUserRow(tx, id);
    });
    return toDetail(row!);
  }

  private async loadTarget(id: string): Promise<UserRow> {
    const row = await repo.findUserRow(this.prisma, id);
    if (!row) throw new DomainError('NOT_FOUND', { message: 'El usuario no existe.' });
    return row;
  }

  /** Propietario, uno mismo y alcance, para acciones que no se permiten sobre uno mismo. */
  private assertCanActOn(actor: Actor, target: UserRow): void {
    const isSelf = actor.userId === target.id;
    if (target.role.code === OWNER_ROLE && !isSelf) throw new DomainError('USER_OWNER_PROTECTED');
    if (isSelf) throw new DomainError('USER_SELF_CHANGE_FORBIDDEN');
    this.assertInScope(actor, target);
  }

  private assertInScope(actor: Actor, target: UserRow): void {
    if (!isWithinScope(actor.permissions, effectivePermissionsOf(target))) {
      throw new DomainError('USER_OUT_OF_SCOPE');
    }
  }

  private assertCanGrantExtras(actor: Actor): void {
    if (!actor.permissions.includes('users.permissions')) {
      throw new DomainError('FORBIDDEN', { details: { permission: 'users.permissions' } });
    }
  }

  private assertNoEscalation(actor: Actor, requested: readonly PermissionCode[]): void {
    const missing = missingPermissions(actor.permissions, requested);
    if (missing.length > 0) {
      throw new DomainError('PERMISSION_ESCALATION', { details: { permissions: missing } });
    }
  }

  /**
   * Las sucursales activas pedidas deben estar en los claims del actor (`BRANCH_FORBIDDEN`).
   * Devuelve las activas; las inexistentes o inactivas las rechaza quien llama con 400.
   */
  private async assertBranchesGrantable(
    actor: Actor,
    branchIds: readonly string[],
  ): Promise<Set<string>> {
    const active = await repo.activeBranchIds(this.prisma, branchIds);
    if ([...active].some((id) => !actor.branchIds.includes(id))) {
      throw new DomainError('BRANCH_FORBIDDEN');
    }
    return active;
  }
}
