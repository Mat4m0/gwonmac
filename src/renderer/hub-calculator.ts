/**
 * Hub currency presentation with inferred market prices and optional manual rates.
 * Market demand stays bounded to a complete visible query through Trade's owner.
 */
import { calculate, currencyInfo, decimal, divide, evaluateConversion, formatFraction, fraction, multiply, parseConversion, type Currency, type Fraction } from '../shared/hub-calculator.js';
import type { HubPresenter, HubRow, HubSource } from '../shared/hub.js';
import type { TraderQuoteSnapshot } from '../shared/trade-chat.js';
import { MARKET_CACHE_MS, MARKET_MAX_AGE_MS, type MarketSnapshot, type MarketQuote, type MarketSide } from '../shared/market-rates.js';
import { calculateTitle } from '../shared/title-calculator.js';
import { currencyIcon } from '../shared/currency-assets.js';
export const HUB_QUOTE_FRESH_MS = 5 * 60_000;
export function createHubCalculator(options: {
  copy(value:string):Promise<void>; marketEnabled():boolean; quotes():Promise<TraderQuoteSnapshot>; market?():Promise<MarketSnapshot>; hub?:HubPresenter<HTMLElement>;
}):HubSource {
  let visible=false, generation=0, queryKey='', failed=false;
  let marketSnapshot:MarketSnapshot|null=null;
  let marketBasis:MarketSide='wts';
  let snapshot:TraderQuoteSnapshot|null=null;
  let timer:ReturnType<typeof setTimeout>|undefined;
  let manual=false;
  let basis='buy';
  const rates={ecto:'',armbrace:'',zkey:''};
  const listeners=new Set<()=>void>();
  const refresh=()=>{for(const listener of listeners) listener();};
  const clear=()=>{generation++;queryKey='';snapshot=null;marketSnapshot=null;clearTimeout(timer);};
  function editRates(preferManual=false) {
    options.hub?.showView('Conversion rates',target=>{
      const doc=target.ownerDocument,form=doc.createElement('form');form.className='hub-detail';
      const heading=doc.createElement('h2');heading.textContent='Choose your rates';
      const hint=doc.createElement('p');hint.textContent='Your rates stay in this game window. They are estimates, not live market quotes. Leave unknown rates blank.';
      const mode=doc.createElement('select');mode.className='ui-select';mode.setAttribute('aria-label','Rate source');
      for(const [value,label] of [['trader','Automatic observed prices'],['manual','Your rates']] as const){const option=doc.createElement('option');option.value=value;option.textContent=label;mode.append(option);} mode.value=manual||preferManual?'manual':'trader';
      form.append(heading,hint,mode);
      const fields=new Map<keyof typeof rates,HTMLInputElement>();
      for(const [key,label] of [['ecto','Gold per ectoplasm'],['armbrace','Ectoplasm per armbrace'],['zkey','Ectoplasm per Zaishen key']] as const){
        const wrapper=doc.createElement('label');wrapper.textContent=label;const input=doc.createElement('input');input.className='ui-input';input.inputMode='decimal';input.setAttribute('aria-label',label);input.value=rates[key];wrapper.append(input);form.append(wrapper);fields.set(key,input);
      }
      const status=doc.createElement('p');status.setAttribute('role','status');const save=doc.createElement('button');save.type='submit';save.className='ui-button';save.textContent='Use these rates';form.append(status,save);target.append(form);
      form.onsubmit=event=>{event.preventDefault();try{
        const values={...rates};for(const [key,input] of fields){const value=input.value.trim();if(value&&decimal(value).n<=0n)throw new Error('Rates must be greater than zero.');values[key]=value;}
        Object.assign(rates,values);manual=mode.value==='manual';clear();status.textContent='Rates selected. Go back to your conversion.';refresh();
      }catch(error){status.textContent=error instanceof Error?error.message:'Enter a valid rate.';}};
      mode.focus();return()=>form.remove();
    });
  }
  const result=(id:string,title:string,detail:string,value:string):HubRow=>({id,title,detail,group:'Calculator',action:'Copy result',run:()=>options.copy(value),actions:editRates});
  const titleRows=(entries:NonNullable<ReturnType<typeof calculateTitle>>):HubRow[]=>entries.map((entry,index)=>({
    id:`title:${index}`,title:entry.title,detail:entry.example?`${entry.detail} · ${entry.example}`:entry.detail,group:'Titles',
    ...(entry.problem?{unavailable:entry.title}:{}),
    ...(!entry.input&&!entry.example&&!entry.problem?{preview:entry.detail}:{}),
    action:entry.problem?'Edit calculation':entry.next?'Compare items':entry.example?'Try example':'Copy result',
    ...(entry.next||entry.example?{searchQuery:entry.next??entry.example}:{}),
    run:()=>options.copy(`${entry.title} · ${entry.detail}`),
    ...(entry.input&&entry.from&&entry.to?{conversion:{input:entry.input,from:entry.from,to:entry.to}}:{}),
  }));
  return {
    subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},
    setVisible(next){visible=next;if(!next)clear();},
    search(query){
      const term=query.toLowerCase().trim().replace(/\s+/gu,' ');
      if(!term){clear();return [{id:'title:help',title:'Title calculator',detail:'Points, items needed and offer comparisons',group:'Commands',action:'Open calculator',searchQuery:'titles',run(){}}];}
      const titleResults=calculateTitle(term);
      if(titleResults){clear();return titleRows(titleResults);}
      if(term==='rates'||term==='conversion rates')return [{id:'currency-rates',title:'Conversion rates',detail:manual?'Your rates':'Automatic observed prices',group:'Calculator',action:'Choose rates',run:editRates}];
      try{
        const conversion=parseConversion(term);
        if(!conversion){clear();const value=calculate(term);return value?[result('calculation',formatFraction(value),term,formatFraction(value))]:[];}
        const units=[...conversion.terms.map(entry=>entry.unit),conversion.to];
        const fixed=units.every(unit=>unit==='gold'||unit==='platinum')||units.every(unit=>unit===conversion.to);
        const card=(id:string,rate:(unit:Currency)=>Fraction,detail:string)=>{
          const amount=evaluateConversion(conversion,rate);const unit=conversion.to;
          const label=unit.startsWith('item:')?currencyInfo(unit).name:unit;
          const value=`${id.startsWith('market:')?'~ ':''}${formatFraction(amount)} ${conversion.divisor>1?'stacks ':''}${label}${conversion.perItem?' each':''}${id.startsWith('market:')&&marketSnapshot?.sample?' (sample)':''}`;
          const fractional=currencyInfo(unit).stack!==null&&amount.n%amount.d!==0n;
          const iconFrom=conversion.terms.length===1?currencyIcon(conversion.from):undefined,iconTo=currencyIcon(unit);
          const copied=id.startsWith('quote:')?`${id==='quote:buy'?'Buy from trader':'Sell to trader'}: ${value}`:id==='manual-conversion'?`Your rates: ${value}`:id.startsWith('market:')?`${value} · ${detail}`:value;
          return {...result(id,value,`${detail}${fractional?' · Equivalent value':''}`,copied),conversion:{input:conversion.input,from:conversion.terms.length>1?'Combined value':currencyInfo(conversion.from).name,to:currencyInfo(unit).name,...(iconFrom?{iconFrom}:{}),...(iconTo?{iconTo}:{})}};
        };
        if(fixed){clear();return [card('conversion',unit=>fraction(unit==='gold'?1n:1000n),'Fixed conversion · 1 platinum = 1,000 gold')];}
        if(!visible){clear();return [];}
        if(manual){
          clear();
          const rate=(unit:Currency):Fraction=>{
            if(unit==='gold')return fraction(1n);if(unit==='platinum')return fraction(1000n);
            if(unit==='ecto'&&rates.ecto)return decimal(rates.ecto);
            if((unit==='armbrace'||unit==='zkey')&&rates[unit]&&rates.ecto)return multiply(decimal(rates[unit]),decimal(rates.ecto));
            throw new Error(`Set a rate for ${currencyInfo(unit).name}`);
          };
          // A relative e/a or e/zkey quote does not need an unrelated gold rate.
          const relative=units.every(unit=>unit==='ecto'||unit==='armbrace'||unit==='zkey');
          const relativeRate=(unit:Currency)=>unit==='ecto'?fraction(1n):(unit==='armbrace'||unit==='zkey')&&rates[unit]?decimal(rates[unit]):rate(unit);
          try{return [card('manual-conversion',relative?relativeRate:rate,`Your rates · ${Object.entries(rates).filter(([,value])=>value).map(([unit,value])=>`1 ${unit} = ${value} ${unit==='ecto'?'g':'e'}`).join(' · ')}`)];}
          catch(error){return [{id:'missing-manual-rate',title:error instanceof Error?error.message:'Set conversion rates',detail:'Your rates · No value invented',group:'Calculator',action:'Set rates',run:editRates}];}
        }
        if(!options.marketEnabled()){clear();return [];}
        const unquoted=units.find(unit=>unit==='armbrace'||unit==='zkey');
        if(unquoted){
          if(queryKey!==term){clear();queryKey=term;failed=false;const request=++generation;
            void (options.market?.()??Promise.reject(new Error('Unavailable'))).then(value=>{
              if(generation!==request||!visible||!options.marketEnabled())return;
              marketSnapshot=value;refresh();
            }).catch(()=>{if(generation===request&&visible){failed=true;refresh();}});
          }
          const rows:HubRow[]=[];
          if(marketSnapshot){
            clearTimeout(timer);
            const expiries=[marketSnapshot.fetchedAt+MARKET_CACHE_MS,...marketSnapshot.quotes.flatMap(entry=>[entry.oldest+MARKET_MAX_AGE_MS,entry.newest+24*60*60_000])].filter(expiry=>expiry>=Date.now());
            if(expiries.length)timer=setTimeout(refresh,Math.max(1,Math.min(...expiries)-Date.now()+1));
            for(const side of ['wts','wtb'] as const){
              const used=new Set<MarketQuote>();
              const quote=(item:MarketQuote['item'],denomination:MarketQuote['denomination'])=>{
                const entry=marketSnapshot?.quotes.find(q=>q.item===item&&q.denomination===denomination&&q.side===side);
                if(!entry||Date.now()-entry.oldest>MARKET_MAX_AGE_MS||Date.now()-entry.newest>24*60*60_000)throw new Error('Insufficient evidence');
                used.add(entry);return fraction(BigInt(entry.numerator),BigInt(entry.denominator));
              };
              const relative=units.every(unit=>unit==='ecto'||unit==='armbrace'||unit==='zkey');
              const inEcto=(unit:Currency):Fraction=>{
                if(unit==='ecto')return fraction(1n);
                if(unit==='armbrace')return quote('armbrace','ecto');
                if(unit==='zkey'){
                  if(marketSnapshot?.quotes.some(q=>q.item==='zkey'&&q.denomination==='ecto'&&q.side===side))return quote('zkey','ecto');
                  return multiply(quote('zkey','armbrace'),quote('armbrace','ecto'));
                }
                throw new Error('Unsupported market route');
              };
              const rate=(unit:Currency):Fraction=>{
                if(relative)return inEcto(unit);
                if(unit==='gold')return fraction(1n);if(unit==='platinum')return fraction(1000n);
                return multiply(inEcto(unit),quote('ecto','gold'));
              };
              try{
                evaluateConversion(conversion,rate);
                const evidence=[...used];const oldest=Math.min(...evidence.map(entry=>entry.oldest));
                const detail=`${marketSnapshot.sample?'Sample data — not live Kamadan prices · Median of simulated ads':'Inferred from median prices in recent Kamadan trade ads'} · ${side==='wts'?'Seller asking prices':'Buyer offers'} · ${evidence.map(entry=>`${entry.advertisers} advertisers (${currencyInfo(entry.item).name})`).join(', ')} · Ads since ${new Date(oldest).toLocaleString()}${Date.now()-marketSnapshot.fetchedAt>MARKET_CACHE_MS?' · Last fetched '+new Date(marketSnapshot.fetchedAt).toLocaleTimeString():''}`;
                const row = card(`market:${side}`,rate,detail);
                const age = Math.max(0, Math.round((Date.now() - marketSnapshot.fetchedAt) / 60000));
                rows.push({ ...row, detail: `${marketSnapshot.sample ? 'Sample prices · ' : ''}${side === 'wts' ? 'Seller asking prices' : 'Buyer offers'} · Inferred median · Updated ${age < 1 ? 'just now' : `${age} min ago`}`, actions: () => options.hub?.showView('Price details', target => {
                  const section = target.ownerDocument.createElement('section'); section.className = 'hub-detail'; const text = target.ownerDocument.createElement('p'); text.textContent = detail; const button = target.ownerDocument.createElement('button'); button.className = 'ui-button'; button.textContent = 'Edit rates'; button.onclick = () => editRates(); section.append(text, button); target.append(section); button.focus(); return () => section.remove();
                }) });
              }catch{/* Incomplete routes never mix in NPC or invented prices. */}
            }
          }
          const chosen=rows.find(row=>row.id===`market:${marketBasis}`)??rows[0];
          if(chosen)return [{...chosen,quoteBasis:{value:chosen.id.slice(7),options:rows.map(row=>({value:row.id.slice(7),label:row.id==='market:wts'?'Seller asking prices':'Buyer offers'})),choose(value){marketBasis=value==='wtb'?'wtb':'wts';refresh();}}}];
          const loading=!marketSnapshot&&!failed;
          return [{id:'market-state',title:loading?'Reading recent Kamadan trades…':'Not enough recent prices',detail:'An estimate needs at least 5 advertisers with consistent prices per rate. No rate is guessed.',group:'Calculator',action:loading?'Loading':'Refresh',...(loading?{unavailable:'Reading recent trades'}:{}),run(){queryKey='';refresh();},actions:editRates}];
        }
        if(queryKey!==term){clear();queryKey=term;failed=false;const request=++generation;
          void options.quotes().then(value=>{if(generation!==request||!visible||!options.marketEnabled())return;snapshot=value;refresh();const expiry=Math.min(...value.quotes.filter(quote=>quote.timestamp+HUB_QUOTE_FRESH_MS>Date.now()).map(quote=>quote.timestamp+HUB_QUOTE_FRESH_MS));if(Number.isFinite(expiry))timer=setTimeout(refresh,Math.max(1,expiry-Date.now()+1));}).catch(()=>{if(generation===request&&visible){failed=true;refresh();}});
        }
        if(!snapshot)return [{id:'quote-state',title:failed?'Rate unavailable':'Loading trader quotes…',detail:'Kamadan · Observed NPC trader quotes',group:'Calculator',action:failed?'Retry':'Loading',...(!failed?{unavailable:'Loading trader quotes…'}:{}),run(){queryKey='';refresh();},actions:editRates}];
        const rows:HubRow[]=[];
        for(const side of ['buy','sell'] as const){
          const stamps:number[]=[];
          const rate=(unit:Currency)=>{
            if(unit==='gold')return fraction(1n);if(unit==='platinum')return fraction(1000n);
            const info=currencyInfo(unit);const quote=snapshot?.quotes.find(q=>q.modelId===info.model&&q.side===side);
            if(!quote||!Number.isSafeInteger(quote.price)||quote.price<=0)throw new Error('Rate unavailable');
            stamps.push(quote.timestamp);return divide(fraction(BigInt(quote.price)),fraction(BigInt(info.quantity)));
          };
          try{
            evaluateConversion(conversion,rate);const stamp=Math.min(...stamps);const age=Date.now()-stamp;
            rows.push(card(`quote:${side}`,rate,`${side==='buy'?'Buy from trader':'Sell to trader'} · ${age>=0&&age<=HUB_QUOTE_FRESH_MS?'Current observation':'Last observed'} ${new Date(stamp).toLocaleString()} · Kamadan · Estimate`));
          }catch{/* A missing quote must never become a zero or an invented rate. */}
        }
        const chosen=rows.find(row=>row.id===`quote:${basis}`)??rows[0];
        if(chosen)return [{...chosen,id:'quote:result',quoteBasis:{value:chosen.id.slice(6),options:rows.map(row=>({value:row.id.slice(6),label:row.id==='quote:buy'?'Buy from trader':'Sell to trader'})),choose(value){basis=value;refresh();}}}];
        return [{id:'quote-missing',title:'Rate unavailable',detail:'No complete observed quote for this conversion',group:'Calculator',action:'Retry',run(){queryKey='';refresh();},actions:editRates}];
      }catch(error){return [{id:'calculation-error',title:error instanceof Error?error.message:'Invalid calculation',detail:'',group:'Calculator',action:'Edit calculation',unavailable:'Edit the calculation',run(){}}];}
    },
  };
}
