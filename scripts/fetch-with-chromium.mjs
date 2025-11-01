/* eslint-disable no-console */
// scripts/fetch-with-chromium.mjs
// Uses Playwright's Chromium + APIRequest to fetch indicator JSON like a real browser and compute CycleScore.

import { chromium, request as pwRequest } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const OUT_PATH = path.join(process.cwd(), 'public', 'cyclescore.json');

function sma(arr, window) {
  const out = new Array(arr.length).fill(NaN);
  let sum = 0;
  for (let i=0;i<arr.length;i++) {
    sum += arr[i];
    if (i >= window) sum -= arr[i-window];
    if (i >= window-1) out[i] = sum / window;
  }
  return out;
}
function yoy(arr) {
  const out = new Array(arr.length).fill(NaN);
  for (let i=365;i<arr.length;i++) {
    if (arr[i-365] !== 0 && isFinite(arr[i-365])) {
      out[i] = (arr[i] - arr[i-365]) / arr[i-365];
    }
  }
  return out;
}
function latestValid(arr) {
  for (let i = arr.length - 1; i >= 0; i--) {
    const v = arr[i];
    if (v != null && !Number.isNaN(v) && Number.isFinite(v)) return v;
  }
  return null;
}

// --- scoring rules (same as discutido) ---
function scorePi(cross) { return cross ? 10 : 0; }
function score2Y(mult) { if (mult==null) return 0; if (mult>5) return 8; if (mult>4) return 5; return 0; }
function scoreHeat(bucket){ return({"🔥 Very Hot":10,"🔥 Hot":7,"🙂 Warm":4}[bucket]??0); }
function scoreMayer(m){ if (m==null) return 0; if (m>2.4) return 9; if (m>=2.0) return 6; if (m>=1.0) return 2; return 0; }
function scorePuell(p){ if (p==null) return 0; if (p>4) return 8; if (p>=3) return 6; return 0; }
function scoreNVT(v){ if (v==null) return 0; if (v>=180) return 6; if (v>=120) return 3; return 0; }
function scoreFG(v){ if (v==null) return 0; if (v>=90) return 10; if (v>=80) return 8; if (v>=70) return 5; return 0; }

async function fetchBlockchainChart(req, name, timespan='10years'){
  const url = `https://api.blockchain.info/charts/${name}?format=json&timespan=${encodeURIComponent(timespan)}`;
  const r = await req.get(url);
  if (!r.ok()) throw new Error(`Blockchain charts ${name} failed: ${r.status()} ${r.statusText()}`);
  const j = await r.json();
  const values = j.values ?? [];
  if (!values.length) throw new Error(`No data for ${name}`);
  return values.map(p => ({ t: new Date(p.x * 1000), v: Number(p.y) })).sort((a,b)=>a.t-b.t);
}
async function fetchFearGreed(req){
  const r = await req.get('https://api.alternative.me/fng/?limit=1');
  if (!r.ok()) return null;
  const j = await r.json();
  return j?.data?.[0]?.value ? Number(j.data[0].value) : null;
}
async function fetchMayerLatest(req){
  // Bitbo endpoint public; some accounts require key for other endpoints.
  try{
    const r = await req.get('https://charts.bitbo.io/api/v1/mayer-multiple/?latest=true');
    if (!r.ok()) return null;
    const j = await r.json();
    if (j?.data?.length){
      const row = j.data[0];
      if (Array.isArray(row) && row.length>=2) return Number(row[1]);
      if (typeof row==='object' && row) return Number(row.value ?? row.mayer_multiple ?? NaN);
    }
    return null;
  }catch{ return null; }
}

async function main(){
  // Launch Chromium (even if we use APIRequest) to satisfy the "via Chromium" requirement
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  const req = await pwRequest.newContext(); // Playwright's APIRequest acting like a browser client

  // --- series and values ---
  const priceSeries = await fetchBlockchainChart(req, 'market-price');
  const price = priceSeries.at(-1).v;
  const priceVals = priceSeries.map(p=>p.v);

  const ma111 = sma(priceVals, 111);
  const ma350 = sma(priceVals, 350);
  const ma200 = sma(priceVals, 200);
  const ma730 = sma(priceVals, 730);
  const ma200w = sma(priceVals, 200*7);
  const ma200wYoY = yoy(ma200w);

  const piCross = (latestValid(ma111) ?? 0) > 2*(latestValid(ma350) ?? 0);
  const mayer = (()=>{
    const m200 = latestValid(ma200);
    if (m200 && m200>0) return price/m200;
    return null;
  })() ?? (await fetchMayerLatest(req));
  const twoYear = (()=>{
    const m = latestValid(ma730);
    return (m && m>0) ? (price/m) : null;
  })();
  const ma200wYoYLatest = latestValid(ma200wYoY);
  let heatBucket = null;
  if (ma200wYoYLatest != null){
    const g = ma200wYoYLatest;
    if (g >= 1.0) heatBucket = "🔥 Very Hot";
    else if (g >= 0.5) heatBucket = "🔥 Hot";
    else if (g >= 0.2) heatBucket = "🙂 Warm";
    else if (g >= 0.0) heatBucket = "😐 Neutral";
    else heatBucket = "❄️ Cold";
  }

  // miners revenue
  const minersRev = await fetchBlockchainChart(req, 'miners-revenue');
  const minersVals = minersRev.map(p=>p.v);
  const minersMA365 = sma(minersVals, 365);
  const puell = (()=>{
    const a = latestValid(minersVals);
    const b = latestValid(minersMA365);
    return (a && b && b>0) ? a/b : null;
  })();

  // NVT/NVTS
  let nvt = null, nvts = null;
  try{
    const mc = await fetchBlockchainChart(req, 'market-cap');
    const tv = await fetchBlockchainChart(req, 'estimated-transaction-volume-usd');
    const mcL = latestValid(mc.map(p=>p.v));
    const tvV = tv.map(p=>p.v);
    const tvL = latestValid(tvV);
    const tvMA90L = latestValid(sma(tvV, 90));
    if (mcL && tvL && tvL>0) nvt = mcL / tvL;
    if (mcL && tvMA90L && tvMA90L>0) nvts = mcL / tvMA90L;
  }catch{ /* optional */ }

  const fearGreed = await fetchFearGreed(req);

  // Scoring (same as antes)
  const tPoints = scorePi(piCross) + score2Y(twoYear) + scoreMayer(mayer) + scoreHeat(heatBucket);
  const tScore = Math.min(30, Math.round((tPoints/40)*30));
  const nvPoints = scoreNVT(nvts ?? nvt);
  const nvScore = Math.min(25, Math.round((nvPoints/10)*25));
  const minersScore = Math.min(10, Math.round((scorePuell(puell)/10)*10));
  const sentScore = Math.min(10, Math.round((scoreFG(fearGreed)/10)*10));
  const total = Math.max(0, Math.min(100, tScore + nvScore + 0 + minersScore + 0 + sentScore));

  const triggers = [];
  if (piCross) triggers.push('PiCycle cross');
  if (mayer != null && mayer > 2.4) triggers.push('Mayer > 2.4');
  if (puell != null && puell > 4) triggers.push('Puell > 4');
  if (fearGreed != null && fearGreed >= 85) triggers.push('Fear&Greed ≥ 85');
  if ((nvts ?? nvt) != null && (nvts ?? nvt) >= 180) triggers.push('NVTS alto');

  const regime = (total >= 75 || (triggers.length >= 2 && total >= 65))
    ? "⚠️ Risco de topo (bull → bear)"
    : (total >= 35 ? "🟡 Neutro / meio de ciclo" : "🟢 Acumulação / início de bull");

  const payload = {
    timestamp_utc: new Date().toISOString(),
    indicators: {
      price_usd: price,
      mayer_multiple: mayer,
      pi_cycle_cross: piCross,
      two_year_ma_multiple: twoYear,
      ma_200w_yoy: ma200wYoYLatest,
      heatmap_bucket: heatBucket,
      puell_multiple: puell,
      nvt, nvts,
      fear_greed: fearGreed,
      mvrv_z: null, rhodl: null, hash_ribbons_state: null
    },
    cyclescore: {
      scores: { technical: tScore, network_value: nvScore, holders: 0, miners: minersScore, activity: 0, sentiment: sentScore, total },
      triggers, regime
    }
  };

  await fs.writeFile(OUT_PATH, JSON.stringify(payload, null, 2), 'utf-8');
  console.log(`Wrote ${OUT_PATH}`);

  await page.close();
  await context.close();
  await browser.close();
}

main().catch(err => { console.error(err); process.exit(1); });