// Token Radar dashboard — renders window.RADAR with no network and no fetch.
//
// State lives in the URL hash so a view can be linked and screenshotted:
//   #view=watchlist | #view=early | #view=live
//   #cat=Risk%20Curators   #q=gauntlet   #sort=tvl   #detail=gauntlet
// Clicking a row opens its detail view; clicking a column header sorts by it.

(function () {
  'use strict';
  var R = window.RADAR;
  if (!R || !Array.isArray(R.rows)) {
    document.getElementById('rows').innerHTML = '<tr><td colspan="9">No radar data loaded.</td></tr>';
    return;
  }

  var $ = function (id) { return document.getElementById(id); };
  var rowsEl = $('rows'), liveEl = $('liveRows'), detailEl = $('detail'), detailBody = $('detailBody');

  function money(n) {
    if (n === null || n === undefined) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }
  function moneyFull(n) {
    if (n === null || n === undefined) return '—';
    return '$' + Math.round(n).toLocaleString('en-US');
  }
  function pct(n) {
    if (n === null || n === undefined) return '—';
    var s = (n > 0 ? '+' : '') + n.toFixed(1) + '%';
    return '<span class="' + (n > 0 ? 'up' : n < 0 ? 'down' : '') + '">' + s + '</span>';
  }
  function ageLabel(d) {
    if (d === null || d === undefined) return '—';
    if (d < 30) return d + 'd';
    if (d < 365) return Math.round(d / 30) + 'mo';
    return (d / 365).toFixed(1) + 'y';
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ---- header stats ----
  $('asof').textContent = R.as_of;
  $('srcDate').textContent = R.as_of;
  $('peerMedian').textContent = R.peer_overall_median;
  var top = R.rows[0];
  $('stats').innerHTML =
    '<div class="stat"><b>' + R.rows.length + '</b><span>protocols ranked</span></div>' +
    '<div class="stat"><b>' + R.watchlist_size + '</b><span>on the watchlist</span></div>' +
    '<div class="stat"><b>' + (R.early_size + (R.wrapped_size || 0)) + '</b><span>early finds below the floor' + (R.wrapped_size ? ' (incl. ' + R.wrapped_size + ' wrapped)' : '') + '</span></div>' +
    '<div class="stat"><b>' + R.live_size + '</b><span>live tokens tracked</span></div>' +
    '<div class="stat"><b>' + money(top ? top.implied_value_usd : 0) + '</b><span>top implied value' + (top ? ' — ' + esc(top.name) : '') + '</span></div>';

  // ---- category filter options ----
  var cats = {};
  R.rows.forEach(function (r) { if (r.category) cats[r.category] = true; });
  Object.keys(cats).sort().forEach(function (c) {
    var o = document.createElement('option');
    o.value = c; o.textContent = c;
    $('cat').appendChild(o);
  });

  // ---- live table ----
  liveEl.innerHTML = R.live.map(function (p) {
    return '<tr><td><span class="name">' + esc(p.name) + '</span> <span class="slug">' + esc(p.slug) + '</span></td>' +
      '<td>' + esc(p.category || '—') + '</td>' +
      '<td class="num">' + money(p.tvl_usd) + '</td>' +
      '<td class="num">' + money(p.mcap_usd) + '</td>' +
      '<td class="num">' + (p.mcap_tvl_ratio === null ? '—' : p.mcap_tvl_ratio.toFixed(2) + '×') + '</td></tr>';
  }).join('');

  // ---- state from the hash ----
  function hashState() {
    var h = {};
    (window.location.hash || '').slice(1).split('&').forEach(function (pair) {
      var kv = pair.split('=');
      if (kv[0]) h[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || '');
    });
    return h;
  }
  var state = hashState();
  var view = state.view || 'all';
  var sortKey = state.sort || 'rank';
  var selectedSlug = state.detail || null;
  if (['all', 'watchlist', 'early', 'wrapped', 'live'].indexOf(view) === -1) view = 'all';
  $('view').value = view;
  $('sort').value = ['rank', 'tvl', 'growth', 'age'].indexOf(sortKey) === -1 ? 'rank' : sortKey;
  sortKey = $('sort').value;
  if (state.cat) $('cat').value = state.cat;
  if (state.q) $('q').value = state.q;

  function writeHash() {
    var parts = [];
    if (view !== 'all') parts.push('view=' + encodeURIComponent(view));
    if ($('cat').value) parts.push('cat=' + encodeURIComponent($('cat').value));
    if ($('q').value) parts.push('q=' + encodeURIComponent($('q').value));
    if (sortKey !== 'rank') parts.push('sort=' + encodeURIComponent(sortKey));
    if (selectedSlug) parts.push('detail=' + encodeURIComponent(selectedSlug));
    var h = parts.join('&');
    if (('#' + h) !== window.location.hash) history.replaceState(null, '', h ? '#' + h : window.location.pathname + window.location.search);
  }

  // ---- filtering + sorting ----
  var SORTS = {
    rank: function (a, b) { return a.rank - b.rank; },
    name: function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; },
    category: function (a, b) { return (a.category || '') < (b.category || '') ? -1 : 1; },
    chains: function (a, b) { return b.chains.length - a.chains.length; },
    tvl: function (a, b) { return b.tvl_usd - a.tvl_usd; },
    growth: function (a, b) { return (b.change_7d === null ? -Infinity : b.change_7d) - (a.change_7d === null ? -Infinity : a.change_7d); },
    age: function (a, b) { return (b.age_days === null ? -1 : b.age_days) - (a.age_days === null ? -1 : a.age_days); },
    value: function (a, b) { return b.implied_value_usd - a.implied_value_usd; }
  };

  function visibleRows() {
    var q = $('q').value.trim().toLowerCase();
    var cat = $('cat').value;
    var list = R.rows.filter(function (r) {
      if (view === 'watchlist' && !r.watchlist) return false;
      if (view === 'early' && r.set !== 'early') return false;
      if (view === 'wrapped' && r.set !== 'wrapped') return false;
      if (cat && r.category !== cat) return false;
      if (q && r.name.toLowerCase().indexOf(q) === -1 && r.slug.toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    var sort = SORTS[sortKey] || SORTS.rank;
    return list.slice().sort(sort);
  }

  function renderBoard() {
    var list, isLive = view === 'live';
    if (isLive) {
      list = R.live.slice().sort(function (a, b) { return (b.mcap_usd || 0) - (a.mcap_usd || 0); });
      rowsEl.innerHTML = list.map(function (p) {
        return '<tr data-slug="' + esc(p.slug) + '" data-live="1">' +
          '<td><span class="badge live">LIVE</span></td>' +
          '<td><span class="name">' + esc(p.name) + '</span> <span class="slug">' + esc(p.slug) + '</span></td>' +
          '<td>' + esc(p.category || '—') + '</td>' +
          '<td class="chains">' + esc(p.chains[0] || '—') + (p.chains.length > 1 ? ' +' + (p.chains.length - 1) : '') + '</td>' +
          '<td class="num">' + money(p.tvl_usd) + '</td>' +
          '<td class="num">' + pct(p.change_7d) + '</td>' +
          '<td class="num">—</td>' +
          '<td class="num">' + money(p.mcap_usd) + '</td>' +
          '<td><span class="badge live">TRADING</span></td></tr>';
      }).join('');
      $('count').textContent = list.length + ' live-token protocols (market cap shown, not a model)';
    } else {
      list = visibleRows();
      rowsEl.innerHTML = list.map(function (r) {
        return '<tr data-slug="' + esc(r.slug) + '"' + (r.slug === selectedSlug ? ' class="selected"' : '') + '>' +
          '<td>' + r.rank + '</td>' +
          '<td><span class="name">' + esc(r.name) + '</span> <span class="slug">' + esc(r.slug) + '</span></td>' +
          '<td>' + esc(r.category || '—') + '</td>' +
          '<td class="chains">' + esc(r.chains[0] || '—') + (r.chains.length > 1 ? ' +' + (r.chains.length - 1) : '') + '</td>' +
          '<td class="num">' + money(r.tvl_usd) + '</td>' +
          '<td class="num">' + pct(r.change_7d) + '</td>' +
          '<td class="num">' + ageLabel(r.age_days) + '</td>' +
          '<td class="num">' + money(r.implied_value_usd) + '</td>' +
          '<td>' + (r.set === 'watchlist' ? '<span class="badge">WATCHLIST</span>' : r.set === 'wrapped' ? '<span class="badge wrapped">WRAPPED</span>' : '<span class="badge early">EARLY</span>') + '</td></tr>';
      }).join('');
      $('count').textContent = list.length + ' of ' + R.rows.length + ' ranked protocols shown';
    }
    document.querySelectorAll('#board thead th[data-sort]').forEach(function (th) {
      th.classList.toggle('sorted', th.getAttribute('data-sort') === sortKey || (th.getAttribute('data-sort') === 'value' && sortKey === 'rank'));
    });
  }

  // ---- detail view ----
  function showDetail(slug) {
    selectedSlug = slug;
    var r = null, live = null;
    for (var i = 0; i < R.rows.length; i++) if (R.rows[i].slug === slug) r = R.rows[i];
    if (!r) for (var j = 0; j < R.live.length; j++) if (R.live[j].slug === slug) live = R.live[j];
    if (!r && !live) { detailEl.hidden = true; return; }
    var html;
    if (r) {
      var base = Math.round(r.tvl_usd * r.peer_multiple);
      html = '<h2>#' + r.rank + ' — ' + esc(r.name) + '</h2>' +
        '<p class="meta"><span>Slug <b>' + esc(r.slug) + '</b></span><span>Category <b>' + esc(r.category || '—') + '</b></span>' +
        '<span>Chains <b>' + esc(r.chains.join(', ')) + '</b></span><span>Listed <b>' + esc(r.listed_at || 'unknown') + '</b></span>' +
        '<span>Set <b>' + (r.set === 'watchlist' ? 'Watchlist' : r.set === 'wrapped' ? 'Wrapped fill' : 'Early find') + '</b></span></p>' +
        '<table class="breakdown"><thead><tr><th>Model input</th><th class="num">Value</th></tr></thead><tbody>' +
        '<tr><td>TVL</td><td class="num">' + moneyFull(r.tvl_usd) + '</td></tr>' +
        '<tr><td>Peer multiple (' + esc(r.category || 'all categories') + ', ' + (r.peer_count > 0 ? r.peer_count + ' priced peers' : 'overall median') + ')</td><td class="num">' + r.peer_multiple.toFixed(4) + '×</td></tr>' +
        '<tr><td>Base value (TVL × peer multiple)</td><td class="num">' + moneyFull(base) + '</td></tr>' +
        '<tr><td>Growth multiplier (7-day ' + (r.change_7d === null ? 'unreported' : (r.change_7d > 0 ? '+' : '') + r.change_7d.toFixed(1) + '%') + ')</td><td class="num">' + r.growth_multiplier.toFixed(4) + '×</td></tr>' +
        '<tr><td>Maturity multiplier (' + (r.age_days === null ? 'age unknown, 365 days assumed' : r.age_days + ' days with no token') + ')</td><td class="num">' + r.maturity_multiplier.toFixed(4) + '×</td></tr>' +
        '<tr><td>Breadth multiplier (' + r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's') + ')</td><td class="num">' + r.breadth_multiplier.toFixed(4) + '×</td></tr>' +
        '<tr><td><b>Implied value</b></td><td class="num"><b>' + moneyFull(r.implied_value_usd) + '</b></td></tr>' +
        '</tbody></table>' +
        '<h2>Farm plan — 6 steps</h2><ol class="steps">' +
        r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>' +
        '<p class="note">This protocol records no token in the snapshot — that is the record, never proof it has none.' + (r.set === 'wrapped' ? ' It is a wrapped, staked or bridged product of a token that already trades, so its launch case is weaker than a standalone protocol&rsquo;s.' : '') + ' The implied value is the radar&rsquo;s claim from the figures above.</p>';
    } else {
      html = '<h2>' + esc(live.name) + ' <span class="badge live">ALREADY TRADING</span></h2>' +
        '<p class="meta"><span>Slug <b>' + esc(live.slug) + '</b></span><span>Category <b>' + esc(live.category || '—') + '</b></span>' +
        '<span>Chains <b>' + esc(live.chains.join(', ')) + '</b></span></p>' +
        '<table class="breakdown"><tbody>' +
        '<tr><td>TVL</td><td class="num">' + moneyFull(live.tvl_usd) + '</td></tr>' +
        '<tr><td>Market cap (the market&rsquo;s own value)</td><td class="num">' + moneyFull(live.mcap_usd) + '</td></tr>' +
        '<tr><td>Mcap / TVL</td><td class="num">' + (live.mcap_tvl_ratio === null ? '—' : live.mcap_tvl_ratio.toFixed(4) + '×') + '</td></tr>' +
        '</tbody></table>' +
        '<p class="note">Already trading, so it is not ranked on the board — it is part of the yardstick the board is priced against. There is nothing to farm here for a launch.</p>';
    }
    detailBody.innerHTML = html;
    detailEl.hidden = false;
    renderBoard();
    writeHash();
  }

  function hideDetail() {
    selectedSlug = null;
    detailEl.hidden = true;
    renderBoard();
    writeHash();
  }

  // ---- events ----
  rowsEl.addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-slug]');
    if (tr) showDetail(tr.getAttribute('data-slug'));
  });
  $('closeDetail').addEventListener('click', hideDetail);
  document.querySelectorAll('#board thead th[data-sort]').forEach(function (th) {
    th.addEventListener('click', function () {
      var k = th.getAttribute('data-sort');
      sortKey = (k === 'value') ? 'rank' : (SORTS[k] ? k : 'rank');
      if (k === 'rank') sortKey = 'rank';
      $('sort').value = sortKey;
      renderBoard();
      writeHash();
    });
  });
  ['q', 'cat', 'view', 'sort'].forEach(function (id) {
    $(id).addEventListener(id === 'q' ? 'input' : 'change', function () {
      view = $('view').value;
      sortKey = $('sort').value;
      renderBoard();
      writeHash();
    });
  });

  renderBoard();
  if (selectedSlug) showDetail(selectedSlug);
  window.addEventListener('hashchange', function () {
    var h = hashState();
    view = ['all', 'watchlist', 'early', 'wrapped', 'live'].indexOf(h.view) === -1 ? 'all' : h.view;
    sortKey = ['rank', 'tvl', 'growth', 'age'].indexOf(h.sort) === -1 ? 'rank' : h.sort;
    $('view').value = view;
    $('sort').value = sortKey;
    $('cat').value = h.cat || '';
    $('q').value = h.q || '';
    if (h.detail) showDetail(h.detail);
    else { selectedSlug = null; detailEl.hidden = true; renderBoard(); }
  });
})();
