import { expect, it } from "vitest";
import { alignTimeProfile, annualTimeProfile, capacityDuration } from "./capacity-duration";
const start=new Date("2026-01-01T00:00:00Z"),end=new Date("2026-01-02T00:00:00Z");
it("counts exact observed hours, excludes gaps, and includes export magnitude",()=>{
  const points=[100,-80,20,0].map((value,i)=>({t:new Date(+start+i*1800000).toISOString(),value}));
  const d=capacityDuration([...points,points[0],{t:end.toISOString(),value:999}],start,end,80);
  expect(d.observedHours).toBe(2);expect(d.expectedHours).toBe(24);
  expect(d.aboveTargetHours).toBe(.5);expect(d.nearPeakHours).toBe(.5);
  expect(d.points.map(p=>p.kw)).toEqual([100,80,20,0]);
  expect(d.points.at(-1)?.fraction).toBe(1);
});
it("keeps precise rare-peak statistics despite compact display sampling",()=>{
  const points=Array.from({length:48},(_,i)=>({t:new Date(+start+i*1800000).toISOString(),value:i?20:137}));
  const d=capacityDuration(points,start,end,86);
  expect(d.peakKw).toBe(137);expect(d.aboveTargetHours).toBe(.5);
  expect(d.points[0].kw).toBe(137);expect(d.points[1].fraction).toBeCloseTo(1/47);
});
it("does not invent a proposal or readings when annual history is absent",()=>{
  const d=capacityDuration([],start,end,null);
  expect(d.points).toEqual([]);expect(d.peakKw).toBeNull();expect(d.aboveTargetHours).toBeNull();
});
it("calculates time-of-day percentiles from unique signed readings without zero-filling",()=>{
  const observations=[0,10,20,100].map((value,i)=>({t:new Date(+start+i*86400000).toISOString(),value}));
  const profile=annualTimeProfile([...observations,observations[0],{t:"2026-01-05T00:00:00Z",value:NaN}],start,new Date("2026-01-06T00:00:00Z"));
  expect(profile).toHaveLength(1);expect(profile[0]).toMatchObject({time:"00:00",p50:15,count:4});
  expect(profile[0].p90).toBeCloseTo(76);
  expect(profile[0].p99).toBeCloseTo(97.6);
});
it("aligns historical percentiles to UK time through seasonal clock changes",()=>{
  const profile=[{time:"10:00",p50:10,p90:20,p99:30,count:100}];
  expect(alignTimeProfile(profile,["2026-06-01T09:00:00Z","2026-06-01T09:30:00Z"])).toEqual([profile[0],null]);
  expect(annualTimeProfile([{t:start.toISOString(),value:-30}],start,end)[0].p50).toBe(-30);
});
