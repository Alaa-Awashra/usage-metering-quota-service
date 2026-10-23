import { test } from 'node:test';
import { deepStrictEqual, strictEqual, throws } from 'node:assert';
import { evaluate, remaining } from '../../src/rules/evaluate.js';
import { month, optionalMonth, units } from '../../src/validation.js';
const account={monthlyLimit:100,maxPerRequest:30}, user={monthlyLimit:50,maxPerRequest:20};
test('stable rejection order and boundaries',()=>{
  deepStrictEqual(evaluate(account,user,99,49,31),{level:'user',rule:'max_per_request',limit:20});
  deepStrictEqual(evaluate(account,user,99,49,25),{level:'user',rule:'max_per_request',limit:20});
  deepStrictEqual(evaluate({...account,maxPerRequest:10},user,99,49,11),{level:'account',rule:'max_per_request',limit:10});
  deepStrictEqual(evaluate(account,user,0,49,2),{level:'user',rule:'monthly_allowance',limit:50});
  deepStrictEqual(evaluate(account,user,99,0,2),{level:'account',rule:'monthly_allowance',limit:100});
  strictEqual(evaluate(account,user,80,40,10),null);
  strictEqual(remaining(5,10),0);
});
test('strict safe integer input',()=>{
  for(const value of [0,-1,1.2,'1',NaN,Infinity,Number.MAX_SAFE_INTEGER+1]) throws(()=>units(value,'units'));
  strictEqual(units(1,'units'),1);
});

test('calendar month validation rejects year zero and malformed dates', () => {
  for (const invalid of ['0000-01', '2026-00', '2026-13', '2026-1', '2026-001', '2026-10-01', ' 2026-10', 'abc-def', '', 202610, null]) {
    throws(() => month(invalid));
  }
  strictEqual(month('0001-01'), '0001-01-01');
  strictEqual(month('2026-10'), '2026-10-01');
  strictEqual(month('9999-12'), '9999-12-01');
  strictEqual(optionalMonth(undefined), null);
  strictEqual(optionalMonth('2026-10'), '2026-10-01');
});
