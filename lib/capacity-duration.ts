import type { AnnualCapacity, CapacityDuration } from "./types";

const clockFormatter = new Intl.DateTimeFormat("en-GB", { timeZone:"Europe/London", hourCycle:"h23", hour:"2-digit", minute:"2-digit" });
export function annualTimeProfile(points: Array<{t:string;value:number}>, start: Date, end: Date): NonNullable<AnnualCapacity["timeProfile"]> {
  const unique = new Map(points.filter(p => Number.isFinite(p.value) && Date.parse(p.t)>=+start && Date.parse(p.t)<+end).map(p=>[p.t,p.value]));
  const groups = new Map<string,number[]>();
  for(const [t,value] of unique){const time=clockFormatter.format(new Date(t));const values=groups.get(time)??[];values.push(value);groups.set(time,values);}
  return [...groups].sort(([a],[b])=>a.localeCompare(b)).map(([time,values])=>{
    values.sort((a,b)=>a-b);
    const quantile=(q:number)=>{const index=(values.length-1)*q;const lo=Math.floor(index),hi=Math.ceil(index);return values[lo]+(values[hi]-values[lo])*(index-lo);};
    return {time,p50:quantile(.5),p90:quantile(.9),p99:quantile(.99),count:values.length};
  });
}

export function alignTimeProfile(profile: AnnualCapacity["timeProfile"], clock: string[]) {
  const byTime=new Map(profile?.map(p=>[p.time,p]));
  return clock.map(t=>byTime.get(clockFormatter.format(new Date(t)))??null);
}

/** Exact statistics from unique observed half-hours; only the drawing is sampled. */
export function capacityDuration(points: Array<{t:string;value:number}>, start: Date, end: Date, targetKw: number | null): CapacityDuration {
  const unique = new Map(points.filter(p => Number.isFinite(p.value) && Date.parse(p.t) >= +start && Date.parse(p.t) < +end).map(p => [p.t, Math.abs(p.value)]));
  const values = [...unique.values()].sort((a,b) => b-a);
  const validTarget = targetKw !== null && Number.isFinite(targetKw) && targetKw > 0 ? targetKw : null;
  const above = validTarget === null ? null : values.filter(v => v > validTarget).length;
  const indices = new Set<number>();
  if (values.length) {
    for (let i=0;i<=200;i++) indices.add(Math.round(i/200*(values.length-1)));
    // Keep the rarest peaks and the target crossing visible at their true width.
    for (let i=0;i<Math.min(10,values.length);i++) indices.add(i);
    if (above !== null) for (const i of [above-1,above]) if(i>=0 && i<values.length) indices.add(i);
  }
  return {
    points:[...indices].sort((a,b)=>a-b).map(i=>({fraction:values.length>1?i/(values.length-1):0,kw:values[i]})),
    observedHours:values.length*.5,expectedHours:(+end-+start)/3600000,
    peakKw:values[0]??null,nearPeakHours:values[0]>0?values.filter(v=>v>=values[0]*.9).length*.5:0,
    targetKw:validTarget,aboveTargetHours:above===null?null:above*.5,
  };
}
