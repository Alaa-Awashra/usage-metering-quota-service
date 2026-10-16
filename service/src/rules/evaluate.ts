export type Level = 'user'|'account';
export type Rule = 'max_per_request'|'monthly_allowance';
export interface Limit { monthlyLimit: number; maxPerRequest: number }
export interface Rejection { level: Level; rule: Rule; limit: number }
export function evaluate(account: Limit, user: Limit, accountUsed: number, userUsed: number, amount: number): Rejection|null {
  if (amount > user.maxPerRequest) return {level:'user',rule:'max_per_request',limit:user.maxPerRequest};
  if (amount > account.maxPerRequest) return {level:'account',rule:'max_per_request',limit:account.maxPerRequest};
  if (amount > Math.max(0,user.monthlyLimit-userUsed)) return {level:'user',rule:'monthly_allowance',limit:user.monthlyLimit};
  if (amount > Math.max(0,account.monthlyLimit-accountUsed)) return {level:'account',rule:'monthly_allowance',limit:account.monthlyLimit};
  return null;
}
export function remaining(limit: number, used: number): number { return Math.max(0,limit-used); }
