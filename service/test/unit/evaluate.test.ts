import { test } from 'node:test';
import { deepStrictEqual, strictEqual, throws } from 'node:assert';
import { evaluate, remaining } from '../../src/rules/evaluate.js';
import { units } from '../../src/validation.js';
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
