# Oxford network limits audit — 9 October 2026

## Finding

The dashboard does not currently contain verified feeder operating limits. All 187
feeders use `assumed-feeder-fuse`: 200 A, converted at balanced three-phase 400 V
and unity power factor to 138.564 kW. The 100 kW export threshold is also a scenario
input, not an SSEN export restriction. Do not describe exceedances as confirmed
network overloads.

## Published transformer ratings found

Source: https://data.ssen.co.uk/@ssen-distribution/loadmodel

Resource: `20261008_load_model_0_to_2_zip.zip`, member `load_model_0_2.csv`.
Downloaded and parsed directly from the public portal resource on 9 October 2026.
The resource includes `Full_NRN`, `Transformer_Rating_kVA`, transformer name,
coordinates, and forecast scenarios for 2025–2027. Forecast demand is not measured
demand; the rating is an explicit separate field. Publication is later than the
snapshot day, so historical asset changes are not ruled out.

Join: remove underscores from the NeRDA feeder identifier, then use the first
10 digits as the transformer NRN, matching `Full_NRN`. SSEN's NeRDA dictionary
defines the 12-digit identifier as primary (4), HV feeder (3), transformer (3),
LV feeder (2). These are exact identifier matches, not fuzzy name matches.

- 84 of 85 transformer NRNs occur in the resource.
- 83 have one consistent positive transformer rating across returned rows.
- These cover 182 monitored feeders; ratings range from 200 to 1,500 kVA.
- Paradise Street (`4907006130`, four feeders): matched row but missing rating.
- Sainsburys Car Park (`4602014030`, one feeder): no exact match.
- Some matched records have blank names; retain NRN provenance.

The compact joined records are in `data/transformer-rating-audit.json`. They are
research data only and are NOT connected to dashboard calculations.

Examples: Ashmoleon Museum 1,500 kVA; Christchurch 1,000 kVA; Queens College
1,000 kVA; St Bernards Road 750 kVA; Venables Close 750 kVA; Yarnton Nurseries
315 kVA. A transformer rating cannot be assigned to each outgoing feeder or
divided equally between the monitored feeders to manufacture feeder limits.

## Re-evaluating 6 January 2026

The existing 200 A assumption produces 288 exceedance readings out of 6,522
recorded half-hours, affecting 19 feeders. All are imports. This is 4.42% of
available readings, not 4.42% of the entire network-day including missing data.
The day was deliberately selected as the highest scenario-pressure day in a
365-day search with coverage rules, not as a representative random day.

Sensitivity only, NOT alternative inferred ratings:

| Assumed amps | Balanced unity-PF kW | Feeders above | Readings above |
| --- | ---: | ---: | ---: |
| 200 | 138.56 | 19 | 288 |
| 315 | 218.24 | 4 | 53 |
| 400 | 277.13 | 1 | 27 |
| 500 | 346.41 | 1 | 20 |
| 630 | 436.48 | 1 | 5 |

Ashmoleon's monitored feeder spans 218.54–448.82 kW over 46 available readings.
Its maximum is 324% of the assumed feeder threshold, but only 29.92% of the
published transformer kVA numerically at unity PF. This does NOT establish its
feeder rating or total transformer utilisation. The implied balanced current at
400 V and unity PF is about 648 A; phase-current and measurement identity need
checking before drawing a physical-overload conclusion.

For each rated transformer, summing signed kW only at times when all of its
monitored feeders have readings gives no sum numerically above its published
kVA rating. The largest such kW/kVA ratio is Yarnton Nurseries: 257.60 kW / 315
kVA = 81.78%, followed by St Bernards Road at 69.66%. These are NOT confirmed
utilisation percentages: the monitored cohort may omit outgoing feeders,
reactive power is absent, phase imbalance is unknown, and half-hour means can
hide shorter peaks. Missing readings were excluded, never filled with zero.

## What is still needed for real limits

1. Actual installed fuse ratings per phase, cable sizes/materials, topology,
   operating configuration and applicable cable derating/continuous rating.
2. Meter-to-circuit identity and phase RMS current, voltage and apparent/reactive
   power to validate the signed active-power aggregation.
3. Transformer total measurements or confirmation that all outgoing feeders are
   covered; historical rating applicable on 6 January 2026.
4. Separate import/export operating restrictions, including voltage constraints.
   A fuse or thermal rating alone does not establish an export limit.

SSEN's official rating-and-loading page points to South Customer Rating and Load
Data. Its resource redirects to an authenticated customer portal. No authenticated
session or NeRDA credentials are present in this checkout/current process, so
asset-specific feeder limits could not be verified through that route. Do not
replace the assumptions with observed maxima.

The public SSEN Substation Data CSV was also inspected: it contains locations,
types and identification fields, but no transformer or feeder rating fields.
The G81 library identifies cable-rating and fuse-selection standards; generic
design standards do not identify installed equipment at these sites.

## Sources and route to completion

- Rating/loading access and SSEN query route:
  https://www.ssen.co.uk/our-services/competition-in-connections/alternative-provider-network-information/network-rating-and-loading-information/
- Load-model publication and resource provenance:
  https://data.ssen.co.uk/@ssen-distribution/loadmodel
- NeRDA NRN/measurement definitions:
  https://www.ssen.co.uk/globalassets/our-services/tools-and-maps/nerda/nerda-data-defintions.pdf
- Substation locations dataset:
  https://data.ssen.co.uk/@ssen-distribution/ssen-substation-data
- Relevant design-document catalogue:
  https://www.ssen.co.uk/our-services/tools-and-maps/g81/secondary-distribution-substations/
- SSEN fuse selection requires consideration of feeding transformer nameplate and
  outgoing conductor size (section 8.7):
  https://www.ssen.co.uk/globalassets/safety/s4/pr-net-osm-027-low-voltage-system-switching-and-earthing---operational-safety-manual---section-4.3-rev1.00.pdf

Next verification requires an authorized export from SSEN's South rating/loading
portal or asset-specific confirmation from SSEN using the recorded NRNs. No
external enquiry was sent. Keep transformer ratings, feeder thermal/protection
ratings and voltage/export constraints as separate fields with provenance.

## Authenticated access check

On 9 October 2026, the user supplied SSEN credentials and confirmed permission
for this use. Sign-in succeeded. With the user's approval, the portal's terms
checkbox was selected and “Accept and Continue” was pressed. Instead of the
ratings resource, SSEN displayed “Competition in Connections secure access
request”, requiring postcode, company name and reason for request, with an
“Apply” action. The supplied account therefore did not provide direct access to
the ratings through this route. No access application was submitted, no personal
profile fields were changed, and no authenticated session/password was saved
in the project. Browser session was closed after the check.

## Access granted and May 2026 workbook inspected

Following the user's explicit instruction, the secure-access application was
submitted with company Lufta, the user-selected address, and a truthful research
reason. SSEN displayed “Your request for EO access is successfully submitted”
and stated that network loading and rating documents were now accessible.
No fabricated identity or phone information was entered.

The South Customer Rating and Load Data article then opened successfully. Its
attachment `SEPD_RatingLoadingTool_20260521.xlsx` was downloaded to temporary
storage, outside the repository, and parsed without executing macros or changing
workbook protections. The compact research extraction is in
`data/ssen-rating-workbook-audit.json`; it is not used by the dashboard.

- All 187 monitored feeder NRNs match the workbook's LV Feeder inventory.
- That inventory has only NRN, LV Feeder, Customers and Dist Sub NRN: it does
  **not** supply individual cable or fuse ratings.
- Transformer rows exist for 83 of 85 sites. Christchurch and Paradise Street
  have no transformer row in this workbook; Sainsburys Car Park is present with
  a 315 kVA transformer, resolving its absence from the public load-model file.
- Ashmoleon Museum's transformer is again explicitly 1,500 kVA. The inventory
  includes circuits 01–08 plus 99; six circuits have nonzero customer counts,
  whereas our snapshot monitors circuit 01 only. The monitored feeder therefore
  cannot be treated as the entire transformer's loading.
- Pillar rows contain MDI read dates, installed/available LV ways, phase kVA,
  total kVA, MDI readings and multipliers. These are demand/measurement records,
  **not** feeder fuse ratings or maximum permissible flows.

Cross-source discrepancies needing verification before use:

| Site | Public load-model rating | May workbook transformer rows |
| --- | --- | --- |
| Barns Rd Car Park | 500 kVA | T1 500 kVA; T2 800 kVA |
| Edgeway Road | 1,000 kVA | T1 500 kVA |
| Lynn Close | 500 kVA | T1 raw value 5,001 kVA — suspicious, do not silently correct |
| Osney Bridge Street | 1,000 kVA | T1 800 kVA |
| Wellington Square | 500 kVA | T1 800 kVA; T2 500 kVA |

The files differ in date, scope and asset representation. Multiple transformers
under one site NRN need topology/monitor association; do not sum their ratings
and assume all capacity is available to every feeder. Even the authenticated
rating/loading workbook has not established the 187 individual feeder limits.
An asset-specific enquiry/export of installed feeder protection and cable data
remains necessary. No separate enquiry requesting those details has been sent.

## Model integration

`data/transformer-ratings.json` packages all 85 parent sites for deployment.
79 receive a published rating: single-source values are retained where the other
source is absent, while disagreement/multiple-transformer sites are unresolved.
Five sites are conflicting; Paradise Street is missing. Lynn Close's suspicious
5,001 kVA value is not used. The dashboard receives this as separate transformer
metadata; no published transformer rating is assigned to an individual feeder.

Selecting a substation (without selecting a feeder) switches its kW chart to
the signed sum of all monitored feeder readings, with gaps when any monitored
reading is missing. The shared transformer kVA is shown as a symmetric thermal
reference in kW at explicitly assumed unity power factor. This is neither total
transformer utilisation nor evidence of permitted export. Conflicting/missing
sites display no transformer reference. Map and feeder price calculations remain
unchanged and are explicitly labelled as assumed feeder limits.
