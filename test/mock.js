// GASサービスのローカル模擬。実際のGoogle・LINEには接続しない。
const fs = require('fs'); const vm = require('vm'); const path = require('path');
function fmt(d, tz, pat) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(d).map(x => [x.type, x.value]));
  return pat.replace('yyyy', p.year).replace('MM', p.month).replace('dd', p.day).replace('HH', p.hour).replace('mm', p.minute).replace('ss', p.second);
}
function makeSheet(rows) {
  return {
    rows,
    getLastRow: () => rows.length,
    getLastColumn: () => rows.reduce((m, r) => Math.max(m, r.length), 0),
    appendRow: r => rows.push(r.slice()),
    getDataRange: () => ({ getValues: () => rows.map(r => r.slice()) }),
    getRange: (r, c, nr = 1, nc = 1) => ({
      setValue: v => { while (rows.length < r) rows.push([]); rows[r - 1][c - 1] = v; },
      setValues: vs => { for (let i = 0; i < nr; i++) { while (rows.length < r + i) rows.push([]); for (let j = 0; j < nc; j++) rows[r - 1 + i][c - 1 + j] = vs[i][j]; } }
    })
  };
}
function load(opts = {}) {
  const tz = opts.tz || 'Asia/Tokyo';
  const props = Object.assign({ LINE_CHANNEL_ACCESS_TOKEN: 'dummy-token', SHEET_ID: 'sheet-demo', IMAGE_FOLDER_ID: 'folder-demo' }, opts.props || {});
  const sheets = {}; for (const [k, v] of Object.entries(opts.sheets || {})) sheets[k] = makeSheet(v.map(r => r.slice()));
  const files = []; const fetches = []; const cache = {}; const ui = { menus: [], dialogs: [] };
  const profiles = opts.profiles || {};
  const book = { getSheetByName: n => sheets[n] || null, insertSheet: n => (sheets[n] = makeSheet([])) };
  const ctx = {
    console,
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null }) },
    Session: { getScriptTimeZone: () => tz },
    Utilities: { formatDate: (d, z, p) => fmt(d, z, p) },
    SpreadsheetApp: {
      openById: () => book,
      getUi: () => ({
        createMenu: title => { const m = { title, items: [] }; const b = { addItem: (l, f) => { m.items.push([l, f]); return b; }, addToUi: () => ui.menus.push(m) }; return b; },
        showModalDialog: (h, t) => ui.dialogs.push({ file: h.file, title: t })
      })
    },
    HtmlService: { createHtmlOutputFromFile: f => { const h = { file: f, setWidth: () => h, setHeight: () => h }; return h; } },
    CacheService: { getScriptCache: () => ({ get: k => cache[k] || null, put: (k, v) => { cache[k] = v; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    DriveApp: { getFolderById: () => ({ createFile: b => { const id = 'file' + (files.length + 1); files.push({ id, name: b.name }); return { getUrl: () => 'https://drive.google.com/file/d/' + id + '/view' }; } }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: t => ({ setMimeType: () => t }) },
    UrlFetchApp: { fetch: (url, o) => {
      fetches.push({ url, o });
      const r = (code, text) => ({ getResponseCode: () => code, getContentText: () => text, getBlob: () => ({ name: '', setName(n) { this.name = n; return this; } }) });
      if (url.includes('/profile/')) { const id = decodeURIComponent(url.split('/profile/')[1]); return profiles[id] ? r(200, JSON.stringify({ displayName: profiles[id] })) : r(404, '{}'); }
      if (url.includes('/content')) return r(opts.contentCode || 200, '');
      return r(opts.sendCode || 200, '{}');
    } },
    Date
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/Code.gs'), 'utf8'), ctx);
  const env = { ctx, sheets, files, fetches, ui, sheet: n => (sheets[n] ? sheets[n].rows : []) };
  Object.defineProperty(env, 'rows', { get: () => env.sheet('トーク履歴') });
  return env;
}
module.exports = { load };
