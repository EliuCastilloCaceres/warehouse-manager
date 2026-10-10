import { randomBytes, randomUUID } from 'node:crypto';
import type {
  AuthSessionDto,
  ChangePasswordInput,
  LoginInput,
  MeDto,
} from '@warehouse-manager/shared';
import type { FastifyInstance } from 'fastify';
import { DomainError } from '../../core/errors.js';
import { hashPassword, verifyPassword } from '../../core/password.js';
import type { Prisma } from '../../generated/prisma/client.js';
import * as repo from './auth.repository.js';
import type { AuthUser } from './auth.repository.js';
import { buildClaims, generateRefreshToken, hashRefreshToken } from './tokens.js';

type Db = FastifyInstance['prisma'] | Prisma.TransactionClient;

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

/** Sesión emitida: el DTO para el body y el refresh token en claro para la cookie. */
export interface IssuedSession {
  session: AuthSessionDto;
  refreshToken: string;
}

/** La rotación perdió la carrera con otra petición: se trata como reutilización. */
class RotationLostError extends Error {}

export class AuthService {
  /** Hash ficticio para verificar igual cuando el usuario no existe (sin enumeración). */
  private readonly dummyHash: Promise<string>;

  constructor(private readonly app: FastifyInstance) {
    this.dummyHash = hashPassword(randomBytes(16).toString('hex'));
  }

  private get prisma() {
    return this.app.prisma;
  }

  private refreshExpiry(now: Date): Date {
    return new Date(now.getTime() + this.app.config.REFRESH_TTL_DAYS * 86_400_000);
  }

  private toMe(user: AuthUser): MeDto {
    return {
      user: {
        id: user.id,
        username: user.username,
        fullName: user.fullName,
        mustChangePassword: user.mustChangePassword,
        role: user.role,
      },
      permissions: user.permissions,
      branches: user.branches,
    };
  }

  private toSession(user: AuthUser): AuthSessionDto {
    return {
      accessToken: this.app.jwt.sign(buildClaims(user)),
      expiresIn: this.app.config.ACCESS_TTL_MIN * 60,
      me: this.toMe(user),
    };
  }

  private async createRefresh(
    db: Db,
    user: AuthUser,
    meta: RequestMeta,
    now: Date,
    familyId: string = randomUUID(),
  ) {
    const token = generateRefreshToken();
    const row = await repo.createRefreshToken(db, {
      userId: user.id,
      familyId,
      tokenHash: hashRefreshToken(token),
      expiresAt: this.refreshExpiry(now),
      userAgent: meta.userAgent,
      ip: meta.ip,
    });
    return { token, row };
  }

  async login(input: LoginInput, meta: RequestMeta): Promise<IssuedSession> {
    const user = await repo.findUserByUsername(this.prisma, input.username);
    if (!user || !user.isActive) {
      // Mismo costo que un usuario real: la respuesta no revela si el usuario existe.
      await verifyPassword(await this.dummyHash, input.password);
      throw new DomainError('AUTH_INVALID_CREDENTIALS');
    }
    if (!(await verifyPassword(user.passwordHash, input.password))) {
      throw new DomainError('AUTH_INVALID_CREDENTIALS');
    }

    const now = new Date();
    const token = await this.prisma.$transaction(async (tx) => {
      await repo.touchLastLogin(tx, user.id, now);
      const { token } = await this.createRefresh(tx, user, meta, now);
      await this.app.audit.record(
        {
          userId: user.id,
          action: 'auth.login',
          entity: 'User',
          entityId: user.id,
          payload: { userAgent: meta.userAgent },
          ip: meta.ip,
        },
        tx,
      );
      return token;
    });
    return { session: this.toSession(user), refreshToken: token };
  }

  async refresh(token: string | undefined, meta: RequestMeta): Promise<IssuedSession> {
    if (!token) throw new DomainError('AUTH_REFRESH_INVALID');
    const current = await repo.findRefreshByHash(this.prisma, hashRefreshToken(token));
    if (!current) throw new DomainError('AUTH_REFRESH_INVALID');

    const now = new Date();
    if (current.revokedAt) {
      // Revocado por rotación → alguien reusa un token viejo; revocado por logout → inválido.
      if (current.replacedById) await this.reportReuse(current, meta, now);
      throw new DomainError('AUTH_REFRESH_INVALID');
    }
    if (current.expiresAt <= now) throw new DomainError('AUTH_REFRESH_INVALID');

    const user = await repo.findUserById(this.prisma, current.userId);
    if (!user || !user.isActive) {
      await repo.revokeToken(this.prisma, current.id, now);
      throw new DomainError('AUTH_REFRESH_INVALID');
    }

    try {
      const next = await this.prisma.$transaction(async (tx) => {
        const created = await this.createRefresh(tx, user, meta, now, current.familyId);
        const rotated = await repo.rotateRefreshToken(tx, current.id, created.row.id, now);
        if (rotated === 0) throw new RotationLostError();
        return created.token;
      });
      return { session: this.toSession(user), refreshToken: next };
    } catch (error) {
      if (error instanceof RotationLostError) await this.reportReuse(current, meta, now);
      throw error;
    }
  }

  /** Reutilización detectada: revoca toda la familia, la audita y responde 401. */
  private async reportReuse(
    token: { userId: string; familyId: string },
    meta: RequestMeta,
    now: Date,
  ): Promise<never> {
    await this.prisma.$transaction(async (tx) => {
      await repo.revokeFamily(tx, token.familyId, now);
      await this.app.audit.record(
        {
          userId: token.userId,
          action: 'auth.refresh_reused',
          entity: 'RefreshToken',
          entityId: token.familyId,
          payload: { familyId: token.familyId },
          ip: meta.ip,
        },
        tx,
      );
    });
    throw new DomainError('AUTH_REFRESH_REUSED');
  }

  /** Revoca solo el token de la cookie (idempotente). */
  async logout(token: string | undefined): Promise<void> {
    if (!token) return;
    const current = await repo.findRefreshByHash(this.prisma, hashRefreshToken(token));
    if (current) await repo.revokeToken(this.prisma, current.id, new Date());
  }

  /** `MeDto` leído de la BD (no del token); 401 si el usuario ya no está activo. */
  async me(userId: string): Promise<MeDto> {
    const user = await repo.findUserById(this.prisma, userId);
    if (!user || !user.isActive) throw new DomainError('UNAUTHENTICATED');
    return this.toMe(user);
  }

  /** Cambia la contraseña, cierra todas las sesiones y emite una nueva (spec F2 §7). */
  async changePassword(
    userId: string,
    input: ChangePasswordInput,
    meta: RequestMeta,
  ): Promise<IssuedSession> {
    const user = await repo.findUserById(this.prisma, userId);
    if (!user || !user.isActive) throw new DomainError('UNAUTHENTICATED');
    if (!(await verifyPassword(user.passwordHash, input.currentPassword))) {
      throw new DomainError('AUTH_PASSWORD_INCORRECT');
    }
    const passwordHash = await hashPassword(input.newPassword);

    const now = new Date();
    const updated: AuthUser = { ...user, passwordHash, mustChangePassword: false };
    const token = await this.prisma.$transaction(async (tx) => {
      await repo.updatePassword(tx, user.id, passwordHash);
      await repo.revokeAllForUser(tx, user.id, now);
      const { token } = await this.createRefresh(tx, updated, meta, now);
      await this.app.audit.record(
        {
          userId: user.id,
          action: 'auth.password_change',
          entity: 'User',
          entityId: user.id,
          ip: meta.ip,
        },
        tx,
      );
      return token;
    });
    return { session: this.toSession(updated), refreshToken: token };
  }

  /** Revoca todos los refresh activos del usuario (lo usa F4 al desactivar o restablecer). */
  async revokeAllForUser(userId: string, tx?: Prisma.TransactionClient): Promise<number> {
    const result = await repo.revokeAllForUser(tx ?? this.prisma, userId, new Date());
    return result.count;
  }
}
