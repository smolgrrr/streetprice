import type { AnnualCapacity } from "@/lib/types";
import type { ViewScenario } from "@/lib/flexibility";
import { formatKw } from "@/lib/format";

export function CapacityDurationChart({ annual, currentKw, scenario, proposedKw, aboveHours }: {annual?: AnnualCapacity; currentKw:number; scenario:ViewScenario; proposedKw?:number|null; aboveHours?:number|null}) {
  const d = annual?.duration;
  if (!d?.points.length || d.peakKw === null) return <p className="chart-note">Annual loading history unavailable for this feeder. Explore its available 24-hour readings below.</p>;
  const target = proposedKw === undefined ? d.targetKw : proposedKw;
  const excessHours = aboveHours === undefined ? d.aboveTargetHours : aboveHours;
  const covered = target !== null && excessHours !== null ? (1-excessHours/d.observedHours)*100 : null;
  const w=520,h=300,left=48,right=16,top=40,bottom=48;
  const ymax=Math.max(currentKw,d.peakKw,target??0)*1.22;
  const x=(f:number)=>left+f*(w-left-right),y=(kw:number)=>h-bottom-kw/ymax*(h-top-bottom);
  const path=d.points.map((p,i)=>`${i?'L':'M'}${x(p.fraction).toFixed(2)},${y(p.kw).toFixed(2)}`).join(' ');
  const excess = target === null ? [] : d.points.filter(p=>p.kw>target);
  const end=excess.at(-1);
  const excessPath=end && target!==null ? `M${x(0)},${y(target)} ${excess.map(p=>`L${x(p.fraction)},${y(p.kw)}`).join(' ')} L${x(end.fraction)},${y(target)} Z` : '';
  const hours=(v:number)=>v.toLocaleString('en-GB',{maximumFractionDigits:1});
  return <div className="duration-story">
    {covered !== null ? <p className="duration-headline"><strong>{formatKw(target!)} covers {Math.round(covered)}% of recorded time.</strong><span>The annual observed peak was {formatKw(d.peakKw)}.</span></p> : <p className="duration-headline"><strong>Peak observed flow: {formatKw(d.peakKw)}.</strong><span>More annual coverage is needed to propose a smaller size.</span></p>}
    <div className="duration-chart"><svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Annual feeder power sorted from busiest to quietest half-hour, with today's assumed capacity, proposed smaller capacity and flow above the proposed size">
      <title>How often do we need this capacity?</title>
      {[0,.25,.5,.75,1].map(f=><g key={f}><line x1={left} x2={w-right} y1={y(ymax*f)} y2={y(ymax*f)} stroke="#e4e8ec"/><text x={left-10} y={y(ymax*f)+4} textAnchor="end">{Math.round(ymax*f)}</text></g>)}
      <text x={left} y={15}>Power carried (kW)</text>
      <path d={`${path} L${x(1)},${y(0)} L${x(0)},${y(0)} Z`} fill="#edf1f4"/>
      {excessPath ? <path d={excessPath} fill="rgba(185,66,63,.28)"/> : null}
      <path d={path} fill="none" stroke="#263442" strokeWidth="2.5"/>
      <line x1={left} x2={w-right} y1={y(currentKw)} y2={y(currentKw)} stroke="#858e97" strokeWidth="1.5" strokeDasharray="6 5"/>
      <text x={w-right} y={y(currentKw)-8} textAnchor="end">Assumed capacity · {formatKw(currentKw)}</text>
      {target!==null ? <><line x1={left} x2={w-right} y1={y(target)} y2={y(target)} stroke="#1e7f66" strokeWidth={scenario==='long-term'?3:2}/><text x={w-right} y={y(target)+17} textAnchor="end" fill="#1e7f66">Proposed · {formatKw(target)}</text></>:null}
      {[0,.25,.5,.75,1].map(f=><text key={f} x={x(f)} y={h-26} textAnchor={f===0?'start':f===1?'end':'middle'}>{f*100}%</text>)}
      <text x={left} y={h-5}>Busiest → quietest share of recorded time</text>
    </svg></div>
    <div className="duration-facts"><p><strong>{hours(d.nearPeakHours)} hours</strong><span>within 10% of the annual peak</span></p>{excessHours!==null?<p><strong>{hours(excessHours)} hours</strong><span>above the proposed size · shaded red</span></p>:null}</div>
    <p className="chart-note">Red shows observed flow above the selected battery adoption’s minimum feasible capacity. Figure 1 explores the 24-hour response.</p>
    <details className="signal-details"><summary>What this chart measures</summary><p className="chart-note">{hours(d.observedHours)} of {hours(d.expectedHours)} annual hours recorded ({Math.round(d.observedHours/d.expectedHours*100)}%). Missing readings are excluded. Each half-hour’s import or export magnitude is sorted from high to low; the horizontal axis is frequency, not clock time. Sorting does not establish that batteries can recharge between peaks. The grey line is today’s assumed import capacity, not a verified cable rating or export permission.</p></details>
  </div>;
}
