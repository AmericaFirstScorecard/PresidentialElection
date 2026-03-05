const COUNTY_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSIZTPRtdASim51AhXmKWGwcAiQy5eK_59NY1G2v0wVvC8Msjaxp4l-eY3ABqcG6aZVBq6160refJp2/pub?output=csv';
const STATE_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTYDZDogvTe_XB2MdKCfXqgAFdWLGwyEm7Nh-wzYHNwxXWNNZusQL-tqCKnLenoQnUBOxmcZ401rL-m/pub?output=csv';

const STATE_CODE_TO_NAME = {
  AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',CT:'Connecticut',DE:'Delaware',FL:'Florida',GA:'Georgia',HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming',DC:'District of Columbia'
};

const statesMap = L.map('statesMap', { zoomControl: false }).setView([39, -96], 4);
const countiesMap = L.map('countiesMap', { zoomControl: false }).setView([37.8, -96], 4);
L.control.zoom({ position: 'bottomright' }).addTo(statesMap);
L.control.zoom({ position: 'bottomright' }).addTo(countiesMap);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 8,
  attribution: '&copy; OpenStreetMap'
}).addTo(statesMap);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 10,
  attribution: '&copy; OpenStreetMap'
}).addTo(countiesMap);

let stateLayer;
let countyLayer;

const fmtNum = new Intl.NumberFormat('en-US');
const fmtPct = (v) => Number.isFinite(v) ? `${v.toFixed(1)}%` : '—';

function toNumber(v) {
  if (v == null) return NaN;
  const cleaned = String(v).replace(/[,$%\s]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      row.push(field);
      field = '';
    } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && next === '\n') i += 1;
      row.push(field);
      if (row.some((f) => String(f).trim() !== '')) rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some((f) => String(f).trim() !== '')) rows.push(row);

  const headers = rows[0].map((h) => String(h).trim());
  return rows.slice(1).map((vals) => {
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = vals[idx] ?? ''; });
    return obj;
  });
}

function pickColumn(headers, candidates) {
  const lowered = headers.map((h) => h.toLowerCase());
  for (const name of candidates) {
    const idx = lowered.findIndex((h) => h === name || h.includes(name));
    if (idx >= 0) return headers[idx];
  }
  return null;
}

function normalizeCountyName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\b(county|parish|borough|census area|municipality|city and borough|city)\b/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

function normalizeStateName(value) {
  const raw = String(value || '').trim();
  if (raw.length === 2) return STATE_CODE_TO_NAME[raw.toUpperCase()] || raw;
  return raw;
}

function collectCountyResults(rows) {
  const headers = Object.keys(rows[0] || {});
  const countyCol = pickColumn(headers, ['county_name', 'county', 'name']);
  const stateCol = pickColumn(headers, ['state_po', 'state', 'st', 'postal', 'abbr']);
  const candidateCol = pickColumn(headers, ['candidate']);
  const votesCol = pickColumn(headers, ['candidatevotes', 'votes']);

  const countyMap = new Map();
  const stateTotals = new Map();

  if (candidateCol && votesCol) {
    for (const r of rows) {
      const county = r[countyCol] || '';
      const state = normalizeStateName(r[stateCol]);
      const candidate = String(r[candidateCol] || '').trim() || 'Other';
      const votes = toNumber(r[votesCol]);
      if (!county || !state || !Number.isFinite(votes)) continue;

      const key = `${state}|${normalizeCountyName(county)}`;
      if (!countyMap.has(key)) {
        countyMap.set(key, { state, county, totals: {}, totalVotes: 0, leader: 'No data', marginPct: 0 });
      }
      const countyResult = countyMap.get(key);
      countyResult.totals[candidate] = (countyResult.totals[candidate] || 0) + votes;
      countyResult.totalVotes += votes;

      if (!stateTotals.has(state)) stateTotals.set(state, { totals: {}, totalVotes: 0 });
      const st = stateTotals.get(state);
      st.totals[candidate] = (st.totals[candidate] || 0) + votes;
      st.totalVotes += votes;
    }

    countyMap.forEach((result) => {
      const sorted = Object.entries(result.totals).sort((a, b) => b[1] - a[1]);
      const [leader = ['No data', 0], runnerUp = ['No data', 0]] = sorted;
      result.leader = leader[0];
      result.marginPct = result.totalVotes ? ((leader[1] - (runnerUp?.[1] || 0)) / result.totalVotes) * 100 : 0;
    });

    return { countyMap, stateTotals };
  }

  const excludedWords = ['county', 'state', 'fips', 'id', 'reporting', 'percent', 'pct', 'called', 'winner', 'total'];
  const voteCols = headers.filter((h) => {
    const l = h.toLowerCase();
    if (excludedWords.some((w) => l.includes(w))) return false;
    const numericCount = rows.slice(0, 20).filter((r) => Number.isFinite(toNumber(r[h]))).length;
    return numericCount >= 5;
  });

  for (const r of rows) {
    const county = r[countyCol] || '';
    const state = normalizeStateName(r[stateCol]);
    if (!county || !state) continue;

    const totals = {};
    let totalVotes = 0;
    for (const c of voteCols) {
      const v = toNumber(r[c]);
      if (!Number.isFinite(v)) continue;
      totals[c] = v;
      totalVotes += v;
    }
    if (!totalVotes) continue;

    const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]);
    const [leader = ['No data', 0], runnerUp = ['No data', 0]] = sorted;
    const key = `${state}|${normalizeCountyName(county)}`;

    countyMap.set(key, {
      state,
      county,
      totals,
      totalVotes,
      leader: leader[0],
      marginPct: totalVotes ? ((leader[1] - (runnerUp?.[1] || 0)) / totalVotes) * 100 : 0
    });

    if (!stateTotals.has(state)) stateTotals.set(state, { totals: {}, totalVotes: 0 });
    const st = stateTotals.get(state);
    st.totalVotes += totalVotes;
    Object.entries(totals).forEach(([cand, votes]) => {
      st.totals[cand] = (st.totals[cand] || 0) + votes;
    });
  }

  return { countyMap, stateTotals };
}

function collectStateStatus(rows) {
  const headers = Object.keys(rows[0] || {});
  const stateCol = pickColumn(headers, ['state']);
  const statusCol = pickColumn(headers, ['election status', 'status']);
  const winnerCol = pickColumn(headers, ['winner', 'called', 'projected']);
  const reportingCol = pickColumn(headers, ['reporting', 'pct', 'percent']);

  const status = new Map();
  rows.forEach((r) => {
    const state = normalizeStateName(r[stateCol]);
    if (!state) return;
    const electionStatus = String(r[statusCol] || '').trim().toLowerCase();
    const winner = String(r[winnerCol] || '').trim();
    status.set(state, {
      calledFor: electionStatus === 'called' ? (winner || 'Called') : 'Uncalled',
      reportingPct: toNumber(r[reportingCol])
    });
  });
  return status;
}

function candidateColor(name) {
  const palette = ['#2563eb', '#dc2626', '#16a34a', '#f59e0b', '#a855f7', '#06b6d4', '#f97316'];
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = ((hash << 5) - hash) + name.charCodeAt(i);
  return palette[Math.abs(hash) % palette.length];
}

function renderDashboard(stateTotals, stateStatus) {
  const national = {};
  stateTotals.forEach((v) => {
    Object.entries(v.totals).forEach(([cand, votes]) => {
      national[cand] = (national[cand] || 0) + votes;
    });
  });

  const nationalRows = Object.entries(national).sort((a, b) => b[1] - a[1]);
  const nationalBox = document.getElementById('nationalTotals');
  nationalBox.innerHTML = nationalRows.map(([cand, votes]) =>
    `<div class="metric"><span class="name">${cand}</span><span class="value">${fmtNum.format(votes)}</span></div>`
  ).join('');

  const calls = {};
  let avgReporting = 0;
  let reportingCount = 0;
  stateStatus.forEach((v) => {
    calls[v.calledFor] = (calls[v.calledFor] || 0) + 1;
    if (Number.isFinite(v.reportingPct)) {
      avgReporting += v.reportingPct;
      reportingCount += 1;
    }
  });

  document.getElementById('stateCalls').innerHTML = Object.entries(calls)
    .sort((a, b) => b[1] - a[1])
    .map(([cand, states]) => `<div class="metric"><span class="name">${cand}</span><span class="value">${states} states</span></div>`).join('');

  document.getElementById('reportingSummary').innerHTML = `
    <div class="metric"><span class="name">States Reporting</span><span class="value">${reportingCount}</span></div>
    <div class="metric"><span class="name">Average Reporting</span><span class="value">${fmtPct(reportingCount ? avgReporting / reportingCount : NaN)}</span></div>
  `;

  const tableBody = document.querySelector('#stateTable tbody');
  tableBody.innerHTML = '';
  [...stateTotals.entries()].sort((a, b) => a[0].localeCompare(b[0])).forEach(([state, info]) => {
    const sorted = Object.entries(info.totals).sort((a, b) => b[1] - a[1]);
    const [leader = ['—', 0], runnerUp = ['—', 0]] = sorted;
    const margin = info.totalVotes ? ((leader[1] - runnerUp[1]) / info.totalVotes) * 100 : NaN;
    const status = stateStatus.get(state) || { calledFor: '—', reportingPct: NaN };

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${state}</td>
      <td>${leader[0]}</td>
      <td>${fmtNum.format(info.totalVotes)}</td>
      <td>${fmtPct(margin)}</td>
      <td>${fmtPct(status.reportingPct)}</td>
      <td>${status.calledFor}</td>
    `;
    tableBody.appendChild(tr);
  });
}

function updateMaps(statesGeo, countiesGeo, countyMap, stateTotals, stateStatus) {
  if (stateLayer) stateLayer.remove();
  if (countyLayer) countyLayer.remove();

  stateLayer = L.geoJSON(statesGeo, {
    style: (feature) => {
      const state = feature.properties.name;
      const totals = stateTotals.get(state);
      if (!totals) return { color: '#334155', weight: 1, fillColor: '#374151', fillOpacity: 0.7 };
      const winner = Object.entries(totals.totals).sort((a, b) => b[1] - a[1])[0]?.[0] || 'No data';
      return { color: '#0f172a', weight: 1, fillColor: candidateColor(winner), fillOpacity: 0.72 };
    },
    onEachFeature: (feature, layer) => {
      const state = feature.properties.name;
      const totals = stateTotals.get(state);
      const status = stateStatus.get(state) || { calledFor: '—', reportingPct: NaN };
      if (!totals) {
        layer.bindTooltip(`${state}<br/>No county totals yet`);
        return;
      }
      const sorted = Object.entries(totals.totals).sort((a, b) => b[1] - a[1]);
      const [leader = ['—', 0]] = sorted;
      layer.bindTooltip(`${state}<br/>Leader: ${leader[0]} (${fmtNum.format(leader[1])})<br/>Total votes: ${fmtNum.format(totals.totalVotes)}<br/>Reporting: ${fmtPct(status.reportingPct)}<br/>Called: ${status.calledFor}`);
    }
  }).addTo(statesMap);

  countyLayer = L.geoJSON(countiesGeo, {
    style: (feature) => {
      const stateCode = feature.properties.STATEFP;
      const countyName = feature.properties.NAME;
      const stateName = FIPS_TO_STATE[stateCode] || '';
      const key = `${stateName}|${normalizeCountyName(countyName)}`;
      const county = countyMap.get(key);
      if (!county) return { color: '#1f2937', weight: 0.2, fillColor: '#374151', fillOpacity: 0.4 };
      return { color: '#111827', weight: 0.2, fillColor: candidateColor(county.leader), fillOpacity: 0.75 };
    },
    onEachFeature: (feature, layer) => {
      const stateCode = feature.properties.STATEFP;
      const countyName = feature.properties.NAME;
      const stateName = FIPS_TO_STATE[stateCode] || '';
      const county = countyMap.get(`${stateName}|${normalizeCountyName(countyName)}`);
      if (!county) {
        layer.bindTooltip(`${countyName}, ${stateName}<br/>No reporting yet`);
        return;
      }
      layer.bindTooltip(`${countyName}, ${stateName}<br/>Leader: ${county.leader}<br/>Votes: ${fmtNum.format(county.totalVotes)}<br/>Margin: ${fmtPct(county.marginPct)}`);
    }
  }).addTo(countiesMap);
}

const STATE_NAME_TO_FIPS = {
  Alabama:'01',Alaska:'02',Arizona:'04',Arkansas:'05',California:'06',Colorado:'08',Connecticut:'09',Delaware:'10','District of Columbia':'11',Florida:'12',Georgia:'13',Hawaii:'15',Idaho:'16',Illinois:'17',Indiana:'18',Iowa:'19',Kansas:'20',Kentucky:'21',Louisiana:'22',Maine:'23',Maryland:'24',Massachusetts:'25',Michigan:'26',Minnesota:'27',Mississippi:'28',Missouri:'29',Montana:'30',Nebraska:'31',Nevada:'32','New Hampshire':'33','New Jersey':'34','New Mexico':'35','New York':'36','North Carolina':'37','North Dakota':'38',Ohio:'39',Oklahoma:'40',Oregon:'41',Pennsylvania:'42','Rhode Island':'44','South Carolina':'45','South Dakota':'46',Tennessee:'47',Texas:'48',Utah:'49',Vermont:'50',Virginia:'51',Washington:'53','West Virginia':'54',Wisconsin:'55',Wyoming:'56'
};
function stateFips(name) { return STATE_NAME_TO_FIPS[name] || ''; }
const FIPS_TO_STATE = Object.fromEntries(Object.entries(STATE_NAME_TO_FIPS).map(([name, fips]) => [fips, name]));


async function loadAll() {
  const statusEl = document.getElementById('status');
  try {
    statusEl.textContent = 'Fetching county + state sheets…';
    const [countyCsv, stateCsv, statesGeo, countiesGeo] = await Promise.all([
      fetch(COUNTY_CSV_URL).then((r) => r.text()),
      fetch(STATE_CSV_URL).then((r) => r.text()),
      fetch('./us-states.geo (2).json').then((r) => r.json()),
      fetch('./county-geo (1).json').then((r) => r.json())
    ]);

    const countyRows = parseCsv(countyCsv);
    const stateRows = parseCsv(stateCsv);
    const { countyMap, stateTotals } = collectCountyResults(countyRows);
    const stateStatus = collectStateStatus(stateRows);

    renderDashboard(stateTotals, stateStatus);
    updateMaps(statesGeo, countiesGeo, countyMap, stateTotals, stateStatus);

    statusEl.textContent = `Live. Last updated ${new Date().toLocaleTimeString()} • auto-refresh every 60s`;
  } catch (err) {
    statusEl.textContent = `Unable to load live data: ${err.message}`;
    console.error(err);
  }
}

loadAll();
setInterval(loadAll, 60000);
