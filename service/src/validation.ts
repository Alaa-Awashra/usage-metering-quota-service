import { assert } from './errors.js';
export function object(value: unknown): Record<string, unknown> { assert(value && typeof value === 'object' && !Array.isArray(value),400,'validation','Expected JSON object'); return value as Record<string,unknown>; }
export function str(value: unknown, name: string, max = 100): string { assert(typeof value === 'string' && value.trim().length > 0 && value.length <= max,400,'validation',`${name} must be a nonempty string of at most ${max} characters`); return value; }
export function uuid(value: unknown, name = 'id'): string { const s=str(value,name,36); assert(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s),400,'validation',`${name} must be a UUID`); return s; }
export function units(value: unknown, name: string, allowZero = false): number { assert(typeof value === 'number' && Number.isSafeInteger(value) && value >= (allowZero ? 0 : 1),400,'validation',`${name} must be ${allowZero?'a nonnegative':'a positive'} safe integer`); return value; }
export function month(value: unknown): string { const s=str(value,'month',7); assert(/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(s),400,'validation','month must be YYYY-MM'); return `${s}-01`; }
export function optionalMonth(value: unknown): string | null { return value === undefined ? null : month(value); }
