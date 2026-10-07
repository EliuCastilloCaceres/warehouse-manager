import { z } from 'zod';

export const Uuid = z.uuid();
export const IsoDateTime = z.iso.datetime();
export const NonNegativeInt = z.number().int().min(0).max(2_147_483_647);
export const Quantity = z.number().int().min(1).max(2_147_483_647);
export const BasisPoints = z.number().int().min(0).max(10_000);
