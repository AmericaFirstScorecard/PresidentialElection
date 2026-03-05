const COUNTY_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSIZTPRtdASim51AhXmKWGwcAiQy5eK_59NY1G2v0wVvC8Msjaxp4l-eY3ABqcG6aZVBq6160refJp2/pub?output=csv';
const STATE_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTYDZDogvTe_XB2MdKCfXqgAFdWLGwyEm7Nh-wzYHNwxXWNNZusQL-tqCKnLenoQnUBOxmcZ401rL-m/pub?output=csv';

const map = L.map('electionMap', { zoomControl: false }).setView([39, -96], 4);
L.control.zoom({ position: 'bottomright' }).addTo(map);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 10,
  attribution: '&copy; OpenStreetMap'
}).addTo(map);

let stateLayer;
let countyLayer;

const fmtPct = (v) => Number.isFinite(v) ? `${v.toFixed(1)}%` : '—';
const STATE_CODE_TO_NAME = {
  AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',CT:'Connecticut',DE:'Delaware',FL:'Florida',GA:'Georgia',HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming',DC:'District of Columbia'
};
const STATE_NAME_TO_FIPS = {
  Alabama:'01',Alaska:'02',Arizona:'04',Arkansas:'05',California:'06',Colorado:'08',Connecticut:'09',Delaware:'10','District of Columbia':'11',Florida:'12',Georgia:'13',Hawaii:'15',Idaho:'16',Illinois:'17',Indiana:'18',Iowa:'19',Kansas:'20',Kentucky:'21',Louisiana:'22',Maine:'23',Maryland:'24',Massachusetts:'25',Michigan:'26',Minnesota:'27',Mississippi:'28',Missouri:'29',Montana:'30',Nebraska:'31',Nevada:'32','New Hampshire':'33','New Jersey':'34','New Mexico':'35','New York':'36','North Carolina':'37','North Dakota':'38',Ohio:'39',Oklahoma:'40',Oregon:'41',Pennsylvania:'42','Rhode Island':'44','South Carolina':'45','South Dakota':'46',Tennessee:'47',Texas:'48',Utah:'49',Vermont:'50',Virginia:'51',Washington:'53','West Virginia':'54',Wisconsin:'55',Wyoming:'56'
};
const FIPS_TO_STATE = Object.fromEntries(Object.entries(STATE_NAME_TO_FIPS).map(([name, fips]) => [fips, name]));

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const headers = lines[0].split(',').map((h) => h.replace(/^"|"$/g, '').trim());
  return lines.slice(1).map((line) => {
    const values = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
      const c = line[i];
      if (c === '"') {
        if (inQuotes && line[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (c === ',' && !inQuotes) {
        values.push(field);
        field = '';
      } else {
        field += c;
      }
    }
    values.push(field);

    const row = {};
    headers.forEach((h, i) => {
      row[h] = (values[i] || '').replace(/^"|"$/g, '').trim();
    });
    return row;
  });
}

function toNumber(value) {
  const n = Number(String(value ?? '').replace(/[,%\s]/g, ''));
  return Number.isFinite(n) ? n : NaN;
}

function normalizeCountyName(name) {
  return String(name || '').toLowerCase().replace(/\b(county|parish|borough|city)\b/g, '').replace(/[^a-z0-9]/g, '');
}

function normalizeStateName(value) {
  const raw = String(value || '').trim();
  if (raw.length === 2) return STATE_CODE_TO_NAME[raw.toUpperCase()] || raw;
  return raw;
}

function getParty(candidate, partyFromSheet) {
  const p = String(partyFromSheet || '').toLowerCase();
  const c = String(candidate || '').toLowerCase();
  if (p.includes('democrat') || c.includes('gore') || c.includes('democrat')) return 'Democrat';
  if (p.includes('republican') || c.includes('bush') || c.includes('republican')) return 'Republican';
  return 'Other';
}

function colorForParty(party) {
  if (party === 'Democrat') return '#2563eb';
  if (party === 'Republican') return '#dc2626';
  return '#64748b';
}

function aggregateCountyRows(rows) {
  const countyResults = new Map();
  const stateResults = new Map();

  for (const row of rows) {
    const state = normalizeStateName(row.state_po || row.state);
    const county = row.county_name || row.county;
    const candidate = row.candidate || 'Other';
    const party = getParty(candidate, row.party);
    const votes = toNumber(row.candidatevotes || row.votes);
    if (!state || !county || !Number.isFinite(votes)) continue;

    const key = `${state}|${normalizeCountyName(county)}`;
    if (!countyResults.has(key)) countyResults.set(key, { state, county, totals: {}, partyTotals: {} });
    const countyRes = countyResults.get(key);
    countyRes.totals[candidate] = (countyRes.totals[candidate] || 0) + votes;
    countyRes.partyTotals[party] = (countyRes.partyTotals[party] || 0) + votes;

    if (!stateResults.has(state)) stateResults.set(state, { partyTotals: {}, totals: {} });
    const stateRes = stateResults.get(state);
    stateRes.totals[candidate] = (stateRes.totals[candidate] || 0) + votes;
    stateRes.partyTotals[party] = (stateRes.partyTotals[party] || 0) + votes;
  }

  const finish = (entry) => {
    const rankedCandidates = Object.entries(entry.totals).sort((a, b) => b[1] - a[1]);
    const rankedParties = Object.entries(entry.partyTotals).sort((a, b) => b[1] - a[1]);
    const totalVotes = Object.values(entry.totals).reduce((a, b) => a + b, 0);
    const leaderVotes = rankedCandidates[0]?.[1] || 0;
    const runnerVotes = rankedCandidates[1]?.[1] || 0;
    return {
      ...entry,
      leader: rankedCandidates[0]?.[0] || 'No data',
      leadingParty: rankedParties[0]?.[0] || 'Other',
      totalVotes,
      marginPct: totalVotes ? ((leaderVotes - runnerVotes) / totalVotes) * 100 : NaN
    };
  };

  return {
    countyResults: new Map(Array.from(countyResults.entries()).map(([k, v]) => [k, finish(v)])),
    stateResults: new Map(Array.from(stateResults.entries()).map(([k, v]) => [k, finish(v)]))
  };
}

function parseStateStatus(rows) {
  const mapStatus = new Map();
  rows.forEach((row) => {
    const state = normalizeStateName(row.State || row.state);
    if (!state) return;
    const isCalled = String(row['Election status (called, uncalled)'] || '').toLowerCase() === 'called';
    const winner = (row.Winner || '').trim();
    mapStatus.set(state, {
      called: isCalled,
      calledFor: isCalled ? (winner || 'Called') : 'Uncalled',
      reportingPct: toNumber(row['Reporting %'])
    });
  });
  return mapStatus;
}

function renderSummary(stateResults, stateStatus) {
  let demStates = 0;
  let repStates = 0;
  let otherStates = 0;
  let avgReporting = 0;
  let reportingCount = 0;

  stateStatus.forEach((status, stateName) => {
    if (Number.isFinite(status.reportingPct)) {
      avgReporting += status.reportingPct;
      reportingCount += 1;
    }
    if (!status.called) return;
    const winner = status.calledFor.toLowerCase();
    if (winner.includes('gore') || winner.includes('dem')) demStates += 1;
    else if (winner.includes('bush') || winner.includes('rep')) repStates += 1;
    else otherStates += 1;
  });

  let demVotes = 0;
  let repVotes = 0;
  let otherVotes = 0;
  stateResults.forEach((st) => {
    demVotes += st.partyTotals.Democrat || 0;
    repVotes += st.partyTotals.Republican || 0;
    otherVotes += st.partyTotals.Other || 0;
  });

  const total = demVotes + repVotes + otherVotes;
  const demShare = total ? (demVotes / total) * 100 : NaN;
  const repShare = total ? (repVotes / total) * 100 : NaN;

  document.getElementById('nationalOverview').innerHTML = [
    ['Democratic Share', fmtPct(demShare)],
    ['Republican Share', fmtPct(repShare)],
    ['Other Share', fmtPct(total ? (otherVotes / total) * 100 : NaN)]
  ].map(([label, value]) => `<div class="metric"><span class="label">${label}</span><span class="value">${value}</span></div>`).join('');

  document.getElementById('calledOverview').innerHTML = [
    ['Democratic Calls', demStates],
    ['Republican Calls', repStates],
    ['Other Calls', otherStates]
  ].map(([label, value]) => `<div class="metric"><span class="label">${label}</span><span class="value">${value}</span></div>`).join('');

  document.getElementById('reportingOverview').innerHTML = [
    ['States Reporting', reportingCount],
    ['Average Reporting', fmtPct(reportingCount ? avgReporting / reportingCount : NaN)],
    ['Auto Refresh', '60s']
  ].map(([label, value]) => `<div class="metric"><span class="label">${label}</span><span class="value">${value}</span></div>`).join('');
}

function renderMap(statesGeo, countiesGeo, countyResults, stateResults, stateStatus) {
  if (stateLayer) stateLayer.remove();
  if (countyLayer) countyLayer.remove();

  stateLayer = L.geoJSON(statesGeo, {
    style: (feature) => {
      const stateName = feature.properties.name;
      const st = stateResults.get(stateName);
      return {
        weight: 1,
        color: '#12213b',
        fillOpacity: 0.8,
        fillColor: st ? colorForParty(st.leadingParty) : '#64748b'
      };
    },
    onEachFeature: (feature, layer) => {
      const stateName = feature.properties.name;
      const st = stateResults.get(stateName);
      const status = stateStatus.get(stateName);
      if (!st) {
        layer.bindTooltip(`${stateName}<br/>No county reports yet`);
        return;
      }
      layer.bindTooltip(
        `${stateName}<br/>Leader: ${st.leader}<br/>Party Edge: ${st.leadingParty}<br/>Margin: ${fmtPct(st.marginPct)}<br/>Reporting: ${fmtPct(status?.reportingPct)}<br/>Call: ${status?.calledFor || 'Uncalled'}`
      );
    }
  }).addTo(map);

  countyLayer = L.geoJSON(countiesGeo, {
    style: (feature) => {
      const stateName = FIPS_TO_STATE[feature.properties.STATEFP] || '';
      const countyName = feature.properties.NAME;
      const county = countyResults.get(`${stateName}|${normalizeCountyName(countyName)}`);
      return {
        weight: 0.15,
        color: '#23324f',
        fillOpacity: 0.78,
        fillColor: county ? colorForParty(county.leadingParty) : '#64748b'
      };
    },
    onEachFeature: (feature, layer) => {
      const stateName = FIPS_TO_STATE[feature.properties.STATEFP] || '';
      const countyName = feature.properties.NAME;
      const county = countyResults.get(`${stateName}|${normalizeCountyName(countyName)}`);
      if (!county) {
        layer.bindTooltip(`${countyName}, ${stateName}<br/>No county reports`);
        return;
      }
      layer.bindTooltip(`${countyName}, ${stateName}<br/>Leader: ${county.leader}<br/>Party Edge: ${county.leadingParty}<br/>Margin: ${fmtPct(county.marginPct)}`);
    }
  }).addTo(map);

  const refreshVisibility = () => {
    const showCounty = map.getZoom() >= 6;
    if (showCounty) {
      if (map.hasLayer(stateLayer)) map.removeLayer(stateLayer);
      if (!map.hasLayer(countyLayer)) map.addLayer(countyLayer);
    } else {
      if (map.hasLayer(countyLayer)) map.removeLayer(countyLayer);
      if (!map.hasLayer(stateLayer)) map.addLayer(stateLayer);
    }
  };

  map.off('zoomend');
  map.on('zoomend', refreshVisibility);
  refreshVisibility();
}

async function loadAll() {
  const statusEl = document.getElementById('status');
  try {
    const [countyCsv, stateCsv, statesGeo, countiesGeo] = await Promise.all([
      fetch(COUNTY_CSV_URL).then((r) => r.text()),
      fetch(STATE_CSV_URL).then((r) => r.text()),
      fetch('./us-states.geo (2).json').then((r) => r.json()),
      fetch('./county-geo (1).json').then((r) => r.json())
    ]);

    const countyRows = parseCsv(countyCsv);
    const stateRows = parseCsv(stateCsv);
    const { countyResults, stateResults } = aggregateCountyRows(countyRows);
    const stateStatus = parseStateStatus(stateRows);

    renderSummary(stateResults, stateStatus);
    renderMap(statesGeo, countiesGeo, countyResults, stateResults, stateStatus);

    statusEl.textContent = `Live feed active • Last update ${new Date().toLocaleTimeString()} • Public view`; 
  } catch (error) {
    statusEl.textContent = `Live feed unavailable: ${error.message}`;
  }
}

loadAll();
setInterval(loadAll, 60000);
