/**
 * Exact, offline title arithmetic from explicitly entered quantities and progress.
 * This catalogue owns point values; it never reads or stores character state.
 */
import { decimal, divide, formatFraction, fraction, multiply } from './hub-calculator.js';

type Track = 'sweet' | 'drunk' | 'party' | 'zaishen';
const tracks: Record<Track, { name: string; ranks: readonly number[] }> = {
  sweet: { name: 'Sweet Tooth', ranks: [1000, 10000] },
  drunk: { name: 'Drunkard', ranks: [1000, 10000] },
  party: { name: 'Party Animal', ranks: [1000, 10000] },
  zaishen: { name: 'Zaishen', ranks: [250, 500, 1000, 1680, 2800, 4660, 7750, 12960, 21600, 36000, 60000, 100000] },
};
const trackNames: Record<string, Track> = { sweet:'sweet', 'sweet tooth':'sweet', drunk:'drunk', drunkard:'drunk', party:'party', 'party animal':'party', zaishen:'zaishen' };
// Sources and verification date are recorded in docs/hub-title-calculators.md.
const items: readonly { name: string; aliases: readonly string[]; track: Track; points: number }[] = [
  { name:'Birthday Cupcake', aliases:['birthday cupcake','birthday cupcakes','cupcake','cupcakes'], track:'sweet', points:2 },
  { name:'Crème Brûlée', aliases:['crème brûlée','crème brûlées','creme brulee','creme brulees'], track:'sweet', points:3 },
  { name:'Red Bean Cake', aliases:['red bean cake','red bean cakes'], track:'sweet', points:2 },
  { name:"Hunter’s Ale", aliases:["hunter's ale","hunters ale","hunter’s ale"], track:'drunk', points:1 },
  { name:'Bottle of Grog', aliases:['bottle of grog','bottles of grog','grog'], track:'drunk', points:3 },
  { name:'Spiked Eggnog', aliases:['spiked eggnog'], track:'drunk', points:3 },
  { name:'Snowman Summoner', aliases:['snowman summoner','snowman summoners'], track:'party', points:1 },
  { name:'Frosty Tonic', aliases:['frosty tonic','frosty tonics'], track:'party', points:2 },
  { name:'Zaishen Key', aliases:['zaishen key','zaishen keys','zkey','zkeys'], track:'zaishen', points:5 },
];
export type TitleCalculation = Readonly<{ title:string; detail:string; input?:string; from?:string; to?:string; example?:string; next?:string; problem?:boolean }>;
const integer = '(?:[0-9]{1,7}|[0-9]{1,3}(?:,[0-9]{3}){1,2})';
const count = (text: string) => {
  const value=Number(text.replaceAll(',',''));
  if (!Number.isSafeInteger(value) || value<0 || value>1_000_000) throw new Error('Use a whole number from 0 to 1,000,000.');
  return value;
};
const number = (value:number) => value.toLocaleString('en-US');
const getItem = (name:string) => items.find(item=>item.aliases.includes(name));
const pointTrack = (name:string) => {
  const key=name.replace(/ points?$/u,'');
  return Object.hasOwn(trackNames,key)?trackNames[key]:undefined;
};
const card = (title:string,detail:string,input:string,from:string,to:string):TitleCalculation => ({title,detail,input,from,to});
const shopping = (points:number,track:Track):TitleCalculation[] => items.filter(item=>item.track===track).map(item=>{
  const quantity=Math.ceil(points/item.points),excess=quantity*item.points-points;
  return { title: `${number(quantity)} × ${item.name}`, detail:`${item.points} points per item · ${Math.floor(quantity/250)} full stacks + ${quantity%250} items${excess?` · ${excess} excess point${excess===1?'':'s'}`:''} · Base points; normal use restrictions apply` };
});

export function calculateTitle(query:string):readonly TitleCalculation[]|null {
  const term=query.toLowerCase().trim().replace(/\s+/gu,' ');
  if(term.length>160)return null;
  if(term==='titles'||term==='title calculator')return [
    {title:'Points remaining',detail:'Enter your current points. No character data is assumed.',example:'sweet tooth from 7350'},
    {title:'Items into points',detail:'Exact base points for a named consumable.',example:'250 cupcakes in sweet points'},
    {title:'Compare a price per point',detail:'Use an explicit offer, in gold, platinum or ectoplasm.',example:'250 sweet points for 3e'},
    {title:'Plan a Zaishen rank',detail:'Required keys from an explicit starting point.',example:'zaishen rank 3 from 500'},
  ];
  try {
    const progress=/^(sweet tooth|drunkard|party animal|zaishen)(?: (?:rank ([0-9]{1,2})|next|max))?(?: from (.+))?$/u.exec(term);
    if(progress){
      const track=trackNames[progress[1]!]!,definition=tracks[track];
      if(!progress[2]&&progress[3]===undefined)return [{title:definition.name,detail:`Enter current points: ${progress[1]} from 7350${track==='zaishen'?' · Or: zaishen rank 3 from 0':''}`,example:track==='zaishen'?'zaishen rank 3 from 0':`${progress[1]} from 7350`}];
      const raw=progress[3]??'0';
      if(!new RegExp(`^${integer}$`,'u').test(raw))throw new Error('Enter current points as a whole number.');
      const current=count(raw);
      if(track==='zaishen'&&current%5!==0)throw new Error('Zaishen progress uses multiples of 5 points.');
      const rank=progress[2]?Number(progress[2]):undefined;
      if(rank!==undefined&&(rank<1||rank>definition.ranks.length))throw new Error(`Choose a rank from 1 to ${definition.ranks.length}.`);
      const maximum=definition.ranks.at(-1)!;
      const target=rank!==undefined?definition.ranks[rank-1]!:term.includes(' next ')?definition.ranks.find(value=>value>current)??maximum:maximum;
      const remaining=Math.max(0,target-current);
      const detail=`From ${number(current)} entered points · Target ${number(target)}${rank?` (rank ${rank})`:''} · ${remaining===0?'Target reached':'Progress is not read from your character'}`;
      const result=card(`${number(remaining)} points remaining`,detail,number(current),`${definition.name} points`,'To target');
      return track==='zaishen'?[result,...shopping(remaining,track)]:[{...result,...(remaining>0?{next:`${remaining} ${track} points`}:{})}];
    }
    const conversion=new RegExp(`^(${integer})\\s*(?:(stacks?|stk)\\s+)?(.+?) (?:in|to) (.+)$`,'u').exec(term);
    if(conversion){
      const item=getItem(conversion[3]!);const target=pointTrack(conversion[4]!);
      if(!item||!target)return null;
      if(item.track!==target)throw new Error(`${item.name} gives ${tracks[item.track].name} points.`);
      const quantity=count(conversion[1]!)*(conversion[2]?250:1);
      return [card(`${number(quantity*item.points)} ${tracks[target].name} points`,`${number(quantity)} items × ${item.points} base points · Normal use restrictions apply; no bonus event assumed`,`${number(quantity)} items`,item.name,tracks[target].name)];
    }
    const budget=new RegExp(`^(${integer}) (sweet|sweet tooth|drunk|drunkard|party|party animal|zaishen) points?(?: for ([0-9]{1,9}(?:\\.[0-9]{1,6})?)\\s*(g|gold|p|plat|platinum|k|e|ecto|ectos))?$`,'u').exec(term);
    if(budget){
      const points=count(budget[1]!);const track=trackNames[budget[2]!]!;
      if(!budget[3])return shopping(points,track);
      if(points===0)throw new Error('Use more than zero points to compare an offer.');
      const unit=budget[4]!;const price=decimal(budget[3]);
      if(price.n<=0n)throw new Error('Use a price greater than zero.');
      const perPoint=divide(price,fraction(BigInt(points)));
      const label=/^(?:g|gold)$/u.test(unit)?'gold':/^(?:e|ecto|ectos)$/u.test(unit)?'ecto':'platinum';
      const maximum=tracks[track].ranks.at(-1)!;
      return [card(`${formatFraction(perPoint)} ${label} / point`,`Your entered offer · ${formatFraction(multiply(perPoint,fraction(BigInt(maximum))))} ${label} for ${number(maximum)} points at this same rate · Not a market quote`,`${number(points)} points`,tracks[track].name,'Price per point')];
    }
    return null;
  }catch(error){return [{title:error instanceof Error?error.message:'Check the title calculation.',detail:'Edit the input; no progress was changed.',problem:true}];}
}
