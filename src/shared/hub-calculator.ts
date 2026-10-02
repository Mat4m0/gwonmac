/**
 * Bounded decimal arithmetic and exact Guild Wars unit conversions; never evaluates code.
 * Keeps presentation separate from canonical game and storage owners.
 */
import { TRADER_ITEMS } from "./trader-catalog.js";
export type Fraction = Readonly<{ n: bigint; d: bigint }>;
export const fraction = (n: bigint, d = 1n): Fraction => {
  if (d === 0n) throw new Error('Cannot divide by zero.');
  if (n.toString().length > 80 || d.toString().length > 80) throw new Error('Calculation is too large.');
  return d < 0n ? { n: -n, d: -d } : { n, d };
};
export function decimal(value: string): Fraction {
  if (value.startsWith(".")) value = `0${value}`;
  if (!/^\d{1,12}(?:\.\d{1,6})?$/u.test(value)) throw new Error('Use at most 12 whole digits and six decimal places.');
  const [whole, digits = ''] = value.split('.');
  return fraction(BigInt(`${whole}${digits}`), 10n ** BigInt(digits.length));
}
export function formatFraction(value: Fraction, places = 6): string {
  const requestedPlaces = places;
  const magnitude = value.n < 0n ? -value.n : value.n;
  // Bounded fractions must not display a nonzero value as zero or one significant digit.
  while (magnitude !== 0n && magnitude * 10n ** BigInt(places) < value.d * 100n && places < 82) places++;
  const scale = 10n ** BigInt(places);
  const rounded = (magnitude * scale * 2n + value.d) / (value.d * 2n);
  const whole = rounded / scale;
  const digits = (rounded % scale).toString().padStart(places, '0');
  const rest = places > requestedPlaces ? digits : digits.replace(/0+$/u, '');
  return `${value.n < 0n && rounded !== 0n ? '-' : ''}${whole}${rest ? `.${rest}` : ''}`;
}
/** Group only display digits; canonical decimals used by parsers keep their exact shape. */
export function formatDisplayFraction(value: Fraction): string {
  const [whole, decimalPlaces] = formatFraction(value).split('.');
  return `${whole!.replace(/\B(?=(\d{3})+(?!\d))/gu, ',')}${decimalPlaces ? `.${decimalPlaces}` : ''}`;
}
export function calculate(expression: string): Fraction | null {
  if (!/^[\d\s.+*/()-]+$/u.test(expression) || !/[+*/()-]/u.test(expression)) return null;
  const tokens = expression.match(/\d+(?:\.\d+)?|\.\d+|[+*/()-]/gu) ?? [];
  if (tokens.length > 64 || expression.length > 160) throw new Error('Calculation is too long.');
  let position = 0;
  const atom = (): Fraction => {
    const token = tokens[position++];
    if (token === '-') { const value = atom(); return fraction(-value.n, value.d); }
    if (token === '+') return atom();
    if (token === '(') { const value = sum(); if (tokens[position++] !== ')') throw new Error('Close the parentheses.'); return value; }
    if (!token) throw new Error('Complete the calculation.');
    return decimal(token);
  };
  const product = (): Fraction => {
    let left = atom();
    while (tokens[position] === '*' || tokens[position] === '/') {
      const operator = tokens[position++]; const right = atom();
      left = operator === '*' ? fraction(left.n * right.n, left.d * right.d) : fraction(left.n * right.d, left.d * right.n);
    }
    return left;
  };
  const sum = (): Fraction => {
    let left = product();
    while (tokens[position] === '+' || tokens[position] === '-') {
      const operator = tokens[position++]; const right = product();
      left = fraction(left.n * right.d + (operator === '+' ? 1n : -1n) * right.n * left.d, left.d * right.d);
    }
    return left;
  };
  const result = sum();
  if (position !== tokens.length || tokens.join('') !== expression.replace(/\s/gu, '')) throw new Error('Complete the calculation.');
  return result;
}
export type Currency = 'gold' | 'platinum' | 'ecto' | 'armbrace' | 'zkey' | `item:${string}`;
export type CurrencyInfo = Readonly<{ name: string; short: string; stack: number | null; model?: string; quantity: number }>;
const core: Record<string, Currency> = { g:'gold',gold:'gold',p:'platinum',plat:'platinum',platinum:'platinum',k:'platinum',e:'ecto',ecto:'ecto',ectos:'ecto',ectoplasm:'ecto','glob of ectoplasm':'ecto','globs of ectoplasm':'ecto',a:'armbrace',arm:'armbrace',arms:'armbrace',armbrace:'armbrace',armbraces:'armbrace','armbrace of truth':'armbrace',zkey:'zkey',zkeys:'zkey','zaishen key':'zkey','zaishen keys':'zkey' };
const metadata: Record<string, CurrencyInfo> = {
 gold:{name:'Gold',short:'g',stack:null,quantity:1}, platinum:{name:'Platinum',short:'p',stack:null,quantity:1},
 ecto:{name:'Glob of Ectoplasm',short:'e',stack:250,quantity:1,model:'0b03a2'},
 armbrace:{name:'Armbrace of Truth',short:'a',stack:250,quantity:1}, zkey:{name:'Zaishen Key',short:'zkey',stack:250,quantity:1},
};
for (const item of TRADER_ITEMS) {
 if (item.modelId === '0b03a2') continue;
 const id: Currency = `item:${item.modelId}`;
 metadata[id] = {name:item.name,short:item.name,stack:item.category.endsWith('materials') || item.category === 'dyes' ? 250 : null,quantity:item.quantity,model:item.modelId};
 core[item.name.toLowerCase()] = id;
 if (item.category.endsWith('materials')) core[`${item.name.toLowerCase()}s`] = id;
}
for (const [alias,name] of Object.entries({iron:'Iron Ingot',feathers:'Feather',dust:'Pile of Glittering Dust',bones:'Bone',granite:'Granite Slab',cloth:'Bolt of Cloth',wood:'Wood Plank',fiber:'Plant Fiber',fibers:'Plant Fiber','obby shards':'Obsidian Shard',lockpicks:'Lockpick'})) {
 const unit=core[name.toLowerCase()]; if(unit) core[alias]=unit;
}
// The parser and live input glyphs share this completed catalogue.
export const CURRENCY_ALIASES: Readonly<Record<string, Currency>> = Object.freeze(core);
export const currencyInfo = (unit: Currency): CurrencyInfo => metadata[unit]!;
export const multiply = (a:Fraction,b:Fraction) => fraction(a.n*b.n,a.d*b.d);
export const divide = (a:Fraction,b:Fraction) => fraction(a.n*b.d,a.d*b.n);
export const add = (a:Fraction,b:Fraction) => fraction(a.n*b.d+b.n*a.d,a.d*b.d);
export type Conversion = { amount:Fraction; from:Currency; to:Currency; terms:readonly {amount:Fraction;unit:Currency}[]; divisor:number; input:string; perItem:boolean };
export function parseConversion(query:string): Conversion|null {
 const normalized=query.toLowerCase().trim().replace(/\s+/gu,' ');
 if(normalized.length>160) return null;
 const parts=normalized.split(/\s+(?:in|to)\s+/u); if(parts.length!==2) return null;
 let target=parts[1]!; const each=/ (?:each|ea)$/u.test(target); target=target.replace(/ (?:each|ea)$/u,'');
 let targetStacks=false;
 if(/^(?:stacks?|stk) /u.test(target)){targetStacks=true;target=target.replace(/^(?:stacks?|stk) /u,'');}
 const to=core[target]; if(!to) return null;
 const terms: {amount:Fraction;unit:Currency}[]=[];
 for(let text of parts[0]!.split(/\s*\+\s*/u)) {
  let perStack=false;
  if(/(?:\/| per )(?:stacks?|stk)$/u.test(text)){perStack=true;text=text.replace(/(?:\/| per )(?:stacks?|stk)$/u,'');}
  const match=/^((?:\d+(?:\.\d+)?|\.\d+)(?:\s*\*\s*(?:\d+(?:\.\d+)?|\.\d+))?)\s*(?:(stacks?|stk)\s+)?(.+)$/u.exec(text);
  if(!match) return null;
  const unit=core[match[3]!.trim()]; if(!unit) return null;
  let amount=match[1]!.split('*').map(v=>decimal(v.trim())).reduce(multiply);
  if(match[2]) { const stack=currencyInfo(unit).stack; if(!stack) throw new Error('This unit has no item stack.'); amount=multiply(amount,fraction(BigInt(stack))); }
  if(perStack){if(!each) throw new Error('Use “in e each” to convert a per-stack price.');amount=divide(amount,fraction(250n));}
  terms.push({amount,unit});
 }
 const divisor=targetStacks ? currencyInfo(to).stack : 1;
 if(!divisor) throw new Error('This unit has no item stack.');
 const first=terms[0]; if(!first) return null;
 return {amount:first.amount,from:first.unit,to,terms,divisor,input:parts[0]!.replace(/(\d)(?=[a-z])/gu,'$1 ')+(each?' each':''),perItem:each};
}
export function convertCurrency(amount:Fraction,from:Currency,to:Currency,ectoGold?:number):Fraction {
 const rate=(unit:Currency):Fraction=>unit==='gold'?fraction(1n):unit==='platinum'?fraction(1000n):unit==='ecto'&&Number.isSafeInteger(ectoGold)&&ectoGold!>0?fraction(BigInt(ectoGold!)):(()=>{throw new Error('Rate unavailable');})();
 return from===to?amount:multiply(amount,divide(rate(from),rate(to)));
}
export function evaluateConversion(conversion:Conversion,rate:(unit:Currency)=>Fraction):Fraction {
 const value=conversion.terms.map(term=>term.unit===conversion.to?term.amount:multiply(term.amount,divide(rate(term.unit),rate(conversion.to)))).reduce(add);
 return divide(value,fraction(BigInt(conversion.divisor)));
}

/** Only currency amounts have a default target; explicit incomplete directions stay editable. */
export function parseDefaultConversion(query: string): Conversion | null {
  if (/(?:^|\s)(?:in|to)(?:\s|$)/iu.test(query)) return null;
  const entered = parseConversion(`${query} in gold`);
  if (!entered || entered.terms.length !== 1) return null;
  const target = entered.from === 'gold' ? 'platinum' : entered.from === 'platinum' ? 'gold'
    : entered.from === 'ecto' ? 'platinum' : entered.from === 'armbrace' || entered.from === 'zkey' ? 'ecto' : null;
  return target ? parseConversion(`${query} in ${target}`) : null;
}

export type CalculatorRates = Readonly<{ mode: 'automatic' | 'manual'; ecto: string; armbrace: string; zkey: string }>;
export const DEFAULT_CALCULATOR_RATES: CalculatorRates = Object.freeze({ mode: 'automatic', ecto: '', armbrace: '', zkey: '' });
/** Trading shorthand in a rate field denotes quantity, not a different rate denomination. */
export function parseManualRate(text: string): string {
  const value = text.trim().toLowerCase();
  if (!value) return '';
  const match = /^((?:\d{1,12}|\d{1,3}(?:,\d{3}){1,3})(?:\.\d{1,6})?|\.\d{1,6})(k)?$/u.exec(value);
  if (!match) throw new Error('Enter a positive number, such as 5,000 or 5k.');
  const amount = multiply(decimal(match[1]!.replaceAll(',', '')), fraction(match[2] ? 1000n : 1n));
  if (amount.n <= 0n) throw new Error('Enter a rate greater than zero.');
  const canonical = formatFraction(amount);
  if(!/^\d{1,12}(?:\.\d{1,6})?$/u.test(canonical))throw new Error('Use at most 12 whole digits and six decimal places.');
  return canonical;
}
/** Validate the whole saved calculator choice at the existing settings boundary. */
export function parseCalculatorRates(value: unknown): CalculatorRates {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid conversion rates.');
  const keys = Object.keys(value);
  if (keys.length !== 4 || !keys.every(key => ['mode', 'ecto', 'armbrace', 'zkey'].includes(key)) ||
      !('mode' in value) || (value.mode !== 'automatic' && value.mode !== 'manual') ||
      !('ecto' in value) || typeof value.ecto !== 'string' || value.ecto.length > 24 ||
      !('armbrace' in value) || typeof value.armbrace !== 'string' || value.armbrace.length > 24 ||
      !('zkey' in value) || typeof value.zkey !== 'string' || value.zkey.length > 24) throw new Error('Invalid conversion rates.');
  return { mode: value.mode, ecto: parseManualRate(value.ecto), armbrace: parseManualRate(value.armbrace), zkey: parseManualRate(value.zkey) };
}

/** Clipboard results always retain the entered question, answer and available provenance. */
export function formatCalculatorCopy(question: string, answer: string, provenance: string): string {
  return `${question} = ${answer}${provenance ? ` · ${provenance}` : ''}`;
}
