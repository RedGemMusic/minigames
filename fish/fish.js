'use strict';
// Fish page: Overview / Fish Log / Profiles over data/fish.json, which
// PublishMinigames.py (stream PC) regenerates about every 15 minutes.
//
// data/fish.json:
//   series  [name]                    regions [name, seriesIx]      pools [name]
//   fish    [fishId, regionIx, shinyEligible, name|null, imgFlags]  (name null = no one has caught it)
//           imgFlags: 1 normal art, 2 shiny art, 4 silhouette (art exists only for caught variants)
//   players [{n, lv, xp, cur, next, casts, landed, fish, treasure, shinies, legend,
//             g, chal, first (day), best: [fishId, shiny, value, rating], recent: [[fishId, shiny, rating]]}]
//   No times of play are published (privacy), so recent catches are an order, not a timeline.
//   catches [playerIx, fishId, shiny, count, bestRating, [poolIx]]

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => Number(n || 0).toLocaleString();
const pct = (a, b) => b ? Math.round(100 * a / b) : 0;
const norm = s => s.trim().replace(/^@/, '').toLowerCase();
const IMG = '../img/fish/';
const SHINY = '✨';

let D = null;
const fishById = new Map();      // fishId -> fish row
const byVariant = new Map();     // fishId*2+shiny -> [{p, count, best, pools}]
const playerByKey = new Map();   // normalized name -> player index
let user = null;                 // player index, or null = everyone
let tab = 'overview';
const sortState = { col: null, dir: 1 };
const filters = { series: '', region: '', fish: '', art: '', variant: '', pools: '', count: '', best: '' };

// ------------------------------------------------------------------ load

fetch('../data/fish.json', { cache: 'no-cache' })
    .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(init)
    .catch(() => { $('#updated').textContent = 'Could not load the fishing data. Try refreshing the page.'; });

function init(data) {
    D = data;
    for (const f of D.fish) fishById.set(f[0], f);
    for (const [p, fid, shiny, count, best, pools] of D.catches) {
        const k = fid * 2 + shiny;
        if (!byVariant.has(k)) byVariant.set(k, []);
        byVariant.get(k).push({ p, count, best, pools });
    }
    D.players.forEach((p, i) => playerByKey.set(norm(p.n), i));

    const q = new URLSearchParams(location.search);
    if (['overview', 'log', 'profiles', 'help'].includes(q.get('tab'))) tab = q.get('tab');
    $('#user').value = q.get('user') || '';
    $('#user').addEventListener('input', () => { resolveUser(); renderAll(); });
    $('#clear').addEventListener('click', () => { $('#user').value = ''; resolveUser(); renderAll(); $('#user').focus(); });
    document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => { tab = b.dataset.tab; renderAll(); }));

    const up = new Date(D.updated);
    $('#updated').textContent = `Updated ${up.toLocaleString()} · refreshed about every 15 minutes`;
    resolveUser();
    renderAll();
}

// Exactly the full username, with or without the @ (capitals don't matter).
function resolveUser() {
    const raw = $('#user').value;
    const k = norm(raw);
    user = playerByKey.has(k) ? playerByKey.get(k) : null;
    const note = $('#userNote');
    note.classList.toggle('bad', !!k && user === null);
    if (user !== null) note.innerHTML = `Showing <b>${esc(D.players[user].n)}</b>'s progress.`;
    else if (k) note.textContent = `No fisher called "${raw.trim()}". Type the full username. Showing everyone for now.`;
    else note.textContent = "Showing everyone's progress. Type your full username to see your own.";
}

function renderAll() {
    const q = new URLSearchParams();
    if (user !== null) q.set('user', D.players[user].n.replace(/^@/, ''));
    if (tab !== 'overview') q.set('tab', tab);
    history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : ''));
    document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    document.querySelectorAll('.panel').forEach(p => p.classList.toggle('on', p.id === tab));
    if (tab === 'overview') renderOverview();
    else if (tab === 'log') renderLog();
    else if (tab === 'profiles') renderProfiles();
    // 'help' is static HTML in index.html
}

function setUser(i) {
    $('#user').value = D.players[i].n;
    resolveUser();
    renderAll();
    window.scrollTo(0, 0);
}

// ------------------------------------------------------------------ helpers

const fishName = fid => (fishById.get(fid) || [])[3] || '???';
const seriesOf = f => D.regions[f[1]][1];

// Art for one variant. state: 'mine' (caught in the current view), 'seen'
// (someone else caught it: dark grey), 'none' (no one: silhouette).
function art(fid, shiny, state) {
    const f = fishById.get(fid), fl = f ? f[4] : 0;
    let src = null;
    if (state !== 'none') {
        if (shiny && (fl & 2)) src = `${fid}s.png`;
        else if (fl & 1) src = `${fid}.png`;   // shiny with no shiny art: the normal art
    }
    if (src) return `<div class="art"><img src="${IMG}${src}" alt="" loading="lazy" class="${state === 'seen' ? 'seen' : ''}"></div>`;
    if (fl & 4) return `<div class="art"><img src="${IMG}sil/${fid}.png" alt="" loading="lazy" class="sil"></div>`;
    return '<div class="art"><span class="none">?</span></div>';
}

// Distinct fish caught per player: [normal, shiny].
function uniqueCounts() {
    const u = D.players.map(() => [new Set(), new Set()]);
    for (const [p, fid, shiny] of D.catches) u[p][shiny].add(fid);
    return u.map(([n, s]) => [n.size, s.size]);
}

// ------------------------------------------------------------------ overview

function boardDefs(uniq) {
    return [
        { title: 'Lifetime G earned', val: i => D.players[i].g, show: v => fmt(v) + ' ' + D.currency },
        {
            title: 'Best catch ever', val: i => D.players[i].best ? D.players[i].best[2] : 0, show: v => fmt(v) + ' ' + D.currency,
            sub: i => { const b = D.players[i].best; return `${esc(fishName(b[0]))}${b[1] ? ` <span class="shiny-mark">${SHINY} Shiny</span>` : ''} · rating ${b[3] ?? '?'}`; }
        },
        { title: 'Unique fish caught', val: i => uniq[i][0] + uniq[i][1], show: v => fmt(v), sub: i => `${uniq[i][0]} normal · ${uniq[i][1]} shiny` },
        { title: 'Total fish caught', val: i => D.players[i].fish, show: v => fmt(v) },
    ];
}

// Competition ranking (1, 1, 3); everyone tied inside the top 3 is listed.
function ranked(def) {
    const vals = D.players.map((_, i) => ({ i, v: def.val(i) })).filter(x => x.v > 0).sort((a, b) => b.v - a.v);
    vals.forEach((x, k) => { x.rank = k && vals[k - 1].v === x.v ? vals[k - 1].rank : k + 1; });
    return vals;
}

function renderOverview() {
    const ps = user !== null ? [D.players[user]] : D.players;
    const sum = k => ps.reduce((a, p) => a + p[k], 0);
    const normal = new Set(), shiny = new Set();
    for (const [p, fid, s] of D.catches) if (user === null || p === user) (s ? shiny : normal).add(fid);
    const totN = D.fish.length, totS = D.fish.filter(f => f[2]).length;

    const tile = (k, v, bar) => `<div class="tile"><div class="k">${k}</div><div class="v">${v}</div>${bar || ''}</div>`;
    const bar = (a, b, cls) => `<div class="bar ${cls || ''}"><i style="width:${pct(a, b)}%"></i></div>`;
    let h = '<div class="tiles">' +
        tile('Total casts', fmt(sum('casts'))) +
        tile('Total fish caught', fmt(sum('fish'))) +
        tile('Normal catches', `${normal.size}<small> / ${totN}</small>`, bar(normal.size, totN)) +
        tile('Shiny catches', `${shiny.size}<small> / ${totS}</small>`, bar(shiny.size, totS, 'shiny')) +
        tile('Total treasures caught', fmt(sum('treasure'))) +
        tile('Total G amassed', fmt(sum('g')) + `<small> ${D.currency}</small>`) +
        '</div>';

    h += '<h2>Top fishers</h2><div class="boards">';
    for (const def of boardDefs(uniqueCounts())) {
        const r = ranked(def);
        const row = (x, extra) => `<li class="${x.rank === 1 ? 'r1' : ''} ${x.i === user ? 'me' : ''} ${extra || ''}">
            <span class="rank">#${x.rank}</span>
            <span class="who"><a href="#" data-p="${x.i}">${esc(D.players[x.i].n)}</a>${def.sub ? `<span class="sub">${def.sub(x.i)}</span>` : ''}</span>
            <span class="val">${def.show(x.v)}</span></li>`;
        const top = r.filter(x => x.rank <= 3);
        let list = top.map(x => row(x)).join('');
        const mine = user !== null && r.find(x => x.i === user);
        if (mine && mine.rank > 3) list += row(mine, 'gap');
        h += `<div class="board"><h3>${def.title}</h3>${list ? `<ol>${list}</ol>` : '<p class="empty">No catches yet.</p>'}</div>`;
    }
    h += '</div>';
    const el = $('#overview');
    el.innerHTML = h;
    el.querySelectorAll('a[data-p]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); tab = 'profiles'; setUser(+a.dataset.p); }));
}

// ------------------------------------------------------------------ fish log

const COLS = [
    { key: 'series', label: 'Series' },
    { key: 'region', label: 'Region' },
    { key: 'fish', label: 'Fish' },
    { key: 'art', label: 'Image' },
    { key: 'variant', label: 'Type' },
    { key: 'pools', label: 'Found in' },
    { key: 'count', label: 'Caught' },
    { key: 'best', label: 'Best Catch #1' },
];

function logRows() {
    const rows = [];
    for (const f of D.fish) {
        const [fid, rix, shinyOk, name] = f;
        for (const shiny of shinyOk ? [0, 1] : [0]) {
            const list = byVariant.get(fid * 2 + shiny) || [];
            const mine = user !== null ? list.find(e => e.p === user) : null;
            const r = {
                fid, shiny, name, sIx: D.regions[rix][1], rIx: rix,
                series: D.series[D.regions[rix][1]], region: D.regions[rix][0],
            };
            if (user === null) {
                r.state = list.length ? 'mine' : 'none';
                r.count = list.reduce((a, e) => a + e.count, 0);
                r.best = list.reduce((a, e) => e.best != null && (a == null || e.best > a) ? e.best : a, null);
                r.bestBy = list.filter(e => e.best === r.best && r.best != null).map(e => D.players[e.p].n);
                r.poolIx = [...new Set(list.flatMap(e => e.pools))].sort((a, b) => a - b);
                r.poolsOwn = true;
            } else {
                r.state = mine ? 'mine' : list.length ? 'seen' : 'none';
                r.count = mine ? mine.count : 0;
                r.best = mine ? mine.best : null;
                r.bestBy = [];
                // Not caught by you yet: where others caught it (muted), to help you target it.
                r.poolIx = mine ? mine.pools : [...new Set(list.flatMap(e => e.pools))].sort((a, b) => a - b);
                r.poolsOwn = !!mine;
            }
            r.pools = r.poolIx.map(i => D.pools[i]);
            r.bestText = r.best == null ? '' : (r.bestBy.length ? r.bestBy.join(', ') + ' - ' : '') + r.best;
            rows.push(r);
        }
    }
    return rows;
}

const STATE_RANK = { mine: 0, seen: 1, none: 2 };
// [missing, value]: missing values sort last in BOTH directions.
const SORT_KEY = {
    series: r => [0, r.series.toLowerCase()],
    region: r => [0, r.region.toLowerCase()],
    fish: r => [r.name == null ? 1 : 0, (r.name || '').toLowerCase()],
    art: r => [0, STATE_RANK[r.state]],
    variant: r => [0, r.shiny],
    pools: r => [r.pools.length ? 0 : 1, (r.pools[0] || '').toLowerCase()],
    count: r => [0, r.count],
    best: r => [r.best == null ? 1 : 0, r.best ?? 0],
};
const defaultOrder = (a, b) => a.sIx - b.sIx || a.rIx - b.rIx || a.fid - b.fid || a.shiny - b.shiny;

function sortRows(rows) {
    const { col, dir } = sortState;
    if (!col) return rows.sort(defaultOrder);
    const key = SORT_KEY[col];
    return rows.sort((a, b) => {
        const ka = key(a), kb = key(b);
        if (ka[0] !== kb[0]) return ka[0] - kb[0];
        const c = ka[1] < kb[1] ? -1 : ka[1] > kb[1] ? 1 : 0;
        return c * dir || defaultOrder(a, b);
    });
}

function filterRows(rows) {
    const t = s => s.trim().toLowerCase();
    const fish = t(filters.fish), pools = t(filters.pools), best = t(filters.best), min = parseInt(filters.count, 10);
    return rows.filter(r =>
        (filters.series === '' || r.sIx === +filters.series) &&
        (filters.region === '' || r.rIx === +filters.region) &&
        (!fish || (r.name && r.name.toLowerCase().includes(fish))) &&
        (filters.variant === '' || r.shiny === +filters.variant) &&
        (filters.art === '' || (filters.art === 'caught' ? r.state === 'mine' : filters.art === 'not' ? r.state !== 'mine' : r.state === filters.art)) &&
        (!pools || r.pools.some(p => p.toLowerCase().includes(pools))) &&
        (isNaN(min) || r.count >= min) &&
        (!best || r.bestText.toLowerCase().includes(best)));
}

function filterRowHtml() {
    const opt = (v, label, cur) => `<option value="${v}"${String(cur) === String(v) ? ' selected' : ''}>${esc(label)}</option>`;
    const sel = (key, options) => `<select data-f="${key}">${options}</select>`;
    const txt = (key, ph) => `<input type="text" data-f="${key}" value="${esc(filters[key])}" placeholder="${ph}">`;
    const series = opt('', 'All') + D.series.map((s, i) => opt(i, s, filters.series)).join('');
    const regions = opt('', 'All') + D.regions.map((r, i) => [r, i])
        .filter(([r]) => filters.series === '' || r[1] === +filters.series).map(([r, i]) => opt(i, r[0], filters.region)).join('');
    const arts = user === null
        ? opt('', 'All') + opt('caught', 'Caught', filters.art) + opt('none', 'Not caught yet', filters.art)
        : opt('', 'All') + opt('caught', 'Caught by you', filters.art) + opt('not', 'Not caught by you', filters.art)
          + opt('seen', 'Caught by others only', filters.art) + opt('none', 'Caught by no one', filters.art);
    return '<tr class="filters">' +
        `<th>${sel('series', series)}</th><th>${sel('region', regions)}</th><th>${txt('fish', 'Name')}</th>` +
        `<th>${sel('art', arts)}</th>` +
        `<th>${sel('variant', opt('', 'All') + opt(0, 'Normal', filters.variant) + opt(1, 'Shiny', filters.variant))}</th>` +
        `<th>${txt('pools', 'Pool')}</th><th><input type="number" min="0" data-f="count" value="${esc(filters.count)}" placeholder="min"></th>` +
        `<th>${txt('best', user === null ? 'Name or rating' : 'Rating')}</th></tr>`;
}

function renderLog() {
    const el = $('#log');
    if (filters.art === 'seen' || filters.art === 'not') { if (user === null) filters.art = ''; }
    const all = logRows();
    const rows = sortRows(filterRows(all));

    // Merge Series / Region / Fish cells across adjacent rows of the same group;
    // the keys nest, so a region never merges across two series.
    const mkeys = [r => r.sIx, r => r.rIx, r => r.fid];
    const spans = mkeys.map(k => {
        const s = new Array(rows.length).fill(0);
        let start = 0;
        rows.forEach((r, i) => { if (i === 0 || k(r) !== k(rows[i - 1])) start = i; s[start]++; });
        return s;
    });

    const head = '<tr>' + COLS.map(c => {
        const on = sortState.col === c.key;
        return `<th class="sortable" data-sort="${c.key}">${c.label}${on ? `<span class="arrow">${sortState.dir > 0 ? '▲' : '▼'}</span>` : ''}</th>`;
    }).join('') + '</tr>' + filterRowHtml();

    const body = rows.map((r, i) => {
        let h = '<tr>';
        const merged = (c, html, cls) => spans[c][i] ? `<td class="m ${cls || ''}" rowspan="${spans[c][i]}"><div>${html}</div></td>` : '';
        h += merged(0, esc(r.series));
        h += merged(1, esc(r.region));
        h += merged(2, r.name ? esc(r.name) : '???', r.name ? '' : 'unknown');
        h += `<td>${art(r.fid, r.shiny, r.state)}</td>`;
        h += `<td><span class="variant ${r.shiny ? 'shiny' : ''}">${r.shiny ? SHINY + ' Shiny' : 'Normal'}</span></td>`;
        h += `<td class="${r.poolsOwn ? '' : 'pools-other'}">${esc(r.pools.join(', '))}</td>`;
        h += `<td class="num ${r.count ? '' : 'dim'}">${r.count || '-'}</td>`;
        h += `<td>${r.best == null ? '<span class="dim">-</span>' : user !== null ? r.best
            : `${r.best} <span class="ties">${esc(r.bestBy.join(', '))}</span>`}</td>`;
        return h + '</tr>';
    }).join('') || `<tr><td colspan="${COLS.length}" class="dim">No fish match these filters.</td></tr>`;

    const known = new Set(all.filter(r => r.state === 'mine').map(r => r.fid * 2 + r.shiny)).size;
    el.innerHTML = `<p class="log-info">${rows.length} of ${all.length} rows · ${known} of ${all.length} ${user === null ? 'caught by someone' : 'caught by you'}
        · click a heading to sort</p>
        <div class="scroll"><table class="fishlog"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
    el.style.setProperty('--thead-h', el.querySelector('thead').offsetHeight + 'px');

    el.querySelectorAll('th[data-sort]').forEach(th => th.addEventListener('click', () => {
        const c = th.dataset.sort;
        if (sortState.col !== c) { sortState.col = c; sortState.dir = 1; }
        else if (sortState.dir > 0) sortState.dir = -1;
        else sortState.col = null;      // third click: back to the game's order
        renderLog();
    }));
    el.querySelectorAll('[data-f]').forEach(inp => {
        const ev = inp.tagName === 'SELECT' ? 'change' : 'input';
        inp.addEventListener(ev, () => {
            filters[inp.dataset.f] = inp.value;
            if (inp.dataset.f === 'series') filters.region = '';
            const focus = inp.tagName === 'INPUT' ? { f: inp.dataset.f, pos: inp.selectionStart } : null;
            renderLog();
            if (focus) {   // re-rendering replaces the inputs: keep typing where you were
                const again = el.querySelector(`[data-f="${focus.f}"]`);
                again.focus();
                try { again.setSelectionRange(focus.pos, focus.pos); } catch (e) { /* number inputs */ }
            }
        });
    });
}

// ------------------------------------------------------------------ profiles

function renderProfiles() {
    const el = $('#profiles');
    const uniq = uniqueCounts();
    if (user === null) {
        el.innerHTML = '<h2>Fishers</h2><div class="players">' + D.players.map((p, i) =>
            `<button type="button" class="pcard" data-p="${i}"><div class="nm">${esc(p.n)}</div>
             <div class="ln">Level ${p.lv} · ${fmt(p.fish)} fish · ${uniq[i][0] + uniq[i][1]} unique</div></button>`).join('') + '</div>';
        el.querySelectorAll('[data-p]').forEach(b => b.addEventListener('click', () => setUser(+b.dataset.p)));
        return;
    }
    const p = D.players[user];

    // Level bar (XP is the G earned; the level table is cumulative).
    const lvl = p.next == null
        ? '<div class="k">Max level</div><div class="bar"><i style="width:100%"></i></div>'
        : `<div class="k">${fmt(p.next - p.xp)} ${D.currency} to level ${p.lv + 1}</div>
           <div class="bar"><i style="width:${pct(p.xp - p.cur, p.next - p.cur)}%"></i></div>`;
    const ranks = boardDefs(uniq).map(def => {
        const r = ranked(def).find(x => x.i === user);
        return r ? `<span class="${r.rank <= 3 ? 'top' : ''}">#${r.rank} ${def.title}</span>` : '';
    }).join('');

    const kv = (k, v) => `<div><div class="k">${k}</div><div class="v">${v}</div></div>`;
    const stats = kv('Casts', fmt(p.casts)) + kv('Fish caught', fmt(p.fish)) + kv('Got away', fmt(p.casts - p.landed)) +
        kv('Catch rate', pct(p.landed, p.casts) + '%') + kv('Treasures', fmt(p.treasure)) +
        kv('Shiny catches', fmt(p.shinies)) + kv('Legendary catches', fmt(p.legend)) +
        kv('Challenges completed', fmt(p.chal)) + kv('G earned', fmt(p.g)) +
        kv('Fishing since', new Date(p.first + 'T00:00:00').toLocaleDateString());   // a day, read as local

    // Collection by series.
    const tot = D.series.map(() => [0, 0]), got = D.series.map(() => [new Set(), new Set()]);
    for (const f of D.fish) { tot[seriesOf(f)][0]++; if (f[2]) tot[seriesOf(f)][1]++; }
    for (const [pi, fid, shiny] of D.catches) if (pi === user) got[seriesOf(fishById.get(fid))][shiny].add(fid);
    const cell = (a, b, cls) => b ? `<span class="cnt">${a} / ${b}</span><div class="bar ${cls || ''}"><i style="width:${pct(a, b)}%"></i></div>` : '<span class="cnt">-</span>';
    const series = D.series.map((s, i) => `<tr><td class="n">${esc(s)}</td><td>${cell(got[i][0].size, tot[i][0])}</td>
        <td>${cell(got[i][1].size, tot[i][1], 'shiny')}</td></tr>`).join('');

    const b = p.best;
    const best = b ? `<div class="best">${art(b[0], b[1], 'mine')}<div><div class="nm">${esc(fishName(b[0]))}${b[1] ? ` <span class="shiny-mark">${SHINY}</span>` : ''}</div>
        <div class="ln">${fmt(b[2])} ${D.currency} · rating ${b[3] ?? '?'}</div></div></div>` : '<p class="dim">No catches yet.</p>';
    const recent = p.recent.length ? '<ul class="recent">' + p.recent.map(([fid, shiny, rating]) =>
        `<li>${art(fid, shiny, 'mine')}<span class="nm">${esc(fishName(fid))}${shiny ? ` <span class="shiny-mark">${SHINY}</span>` : ''}
         <span class="dim"> · ${rating ?? '?'}</span></span></li>`).join('') + '</ul>' : '<p class="dim">No catches yet.</p>';

    el.innerHTML = `<button type="button" class="back" id="allFishers">‹ All fishers</button>
      <div class="profile">
        <div class="phead"><div class="who"><div class="nm">${esc(p.n)}</div>
            <div class="ln">Level ${p.lv}</div><div class="ranks">${ranks}</div></div>
            <div class="lvl">${lvl}</div></div>
        <div class="pgrid">
          <div style="display:grid;gap:16px;align-content:start">
            <div class="box"><h3>Stats</h3><div class="kv">${stats}</div></div>
            <div class="box"><h3>Collection</h3><table class="series"><tr><th>Series</th><th>Normal</th><th>Shiny</th></tr>${series}</table></div>
          </div>
          <div style="display:grid;gap:16px;align-content:start">
            <div class="box"><h3>Best catch</h3>${best}</div>
            <div class="box"><h3>Recent catches</h3>${recent}</div>
          </div>
        </div>
      </div>`;
    $('#allFishers').addEventListener('click', () => { $('#user').value = ''; resolveUser(); renderAll(); });
}
