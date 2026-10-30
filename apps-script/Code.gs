/**
 * Stem Cell Lab – shared stocks & maintenance  (Google Apps Script back end)
 * ------------------------------------------------------------------------
 * HOW IT FITS TOGETHER
 *  - The app page (index.html) is hosted on GitHub Pages – no Google banner.
 *  - This script is the app's server: it answers the page with JSON (doPost).
 *  - The Google Sheet it is attached to is the database (tabs People, Items,
 *    Batches, Tasks, Duty, Log, Devices, Codes).
 *  - Every phone / computer has to be unlocked ONCE with a one-time code.
 *    Codes work once and expire after 48 hours. Only a hash of each code and
 *    device key is stored in the Sheet.
 *
 * SETUP (once)
 *  1. In the Google Sheet: Extensions → Apps Script. Replace everything in
 *     Code.gs with this file. (An "Index" HTML file is no longer needed –
 *     delete it if you have one from the first version.)
 *  2. Save. Choose the function  setup  in the toolbar → Run → allow access.
 *     The Execution log at the bottom shows your FIRST one-time code (it makes
 *     an admin device). Already have data? It is kept – setup only adds tabs.
 *  3. Deploy → New deployment → gear icon → Web app
 *        Execute as: Me          Who has access: Anyone
 *     → Deploy → copy the Web app URL (ends in /exec).
 *  4. Paste that URL into index.html on GitHub:  const API_URL = '…/exec';
 *
 * CHANGING THIS CODE LATER
 *  Deploy → Manage deployments → pencil icon → Version: New version → Deploy
 *  (the URL stays the same, so index.html doesn't change).
 *
 * MORE ONE-TIME CODES: in the app (People → Devices, admin devices only) or
 * in the Sheet menu "Lab app" (reload the Sheet if you don't see it).
 * LOCKED OUT? Use the Sheet menu "Lab app → New one-time code (admin device)".
 *
 * Don't rename tabs or reorder columns. The app never deletes rows: removed
 * things are marked archived / finished / left / revoked, so history stays.
 */

const APP_NAME = 'Stem Cell Lab';

// Column definitions. Types: t = text, n = number, d = date, ts = timestamp, b = TRUE/FALSE
const SCHEMA = {
  People: [['id', 't'], ['name', 't'], ['email', 't'], ['role', 't'], ['active', 'b'], ['inRotation', 'b'],
    ['awayFrom', 'd'], ['awayUntil', 'd'], ['endDate', 'd'], ['joined', 'd'], ['left', 'd']],
  Items: [['id', 't'], ['kind', 't'], ['name', 't'], ['variant', 't'], ['category', 't'], ['supplier', 't'],
    ['catalogNo', 't'], ['storage', 't'], ['temp', 't'], ['unit', 't'], ['minQty', 'n'], ['shelfLifeOpenedDays', 'n'],
    ['ownerId', 't'], ['orderStatus', 't'], ['orderedOn', 'd'], ['orderedBy', 't'], ['checkStatus', 't'],
    ['lastChecked', 'd'], ['notes', 't'], ['archived', 'b'], ['created', 'd']],
  Batches: [['id', 't'], ['itemId', 't'], ['lotNo', 't'], ['qty', 'n'], ['arrived', 'd'], ['expiry', 'd'],
    ['opened', 'd'], ['notes', 't'], ['finished', 'b'], ['created', 'd']],
  Tasks: [['id', 't'], ['key', 't'], ['name', 't'], ['category', 't'], ['equipment', 't'], ['every', 'n'],
    ['unit', 't'], ['responsible', 't'], ['lastDone', 'd'], ['lastDoneBy', 't'], ['notes', 't'],
    ['archived', 'b'], ['created', 'd']],
  Duty: [['weekStart', 'd'], ['basePersonId', 't'], ['overridePersonId', 't']],
  Log: [['timestamp', 'ts'], ['person', 't'], ['action', 't'], ['targetType', 't'], ['targetId', 't'],
    ['target', 't'], ['details', 't'], ['device', 't']],
  Devices: [['id', 't'], ['name', 't'], ['tokenHash', 't'], ['admin', 'b'], ['created', 'ts'], ['lastSeen', 'd'],
    ['revoked', 'b'], ['addedBy', 't']],
  Codes: [['codeHash', 't'], ['created', 'ts'], ['expires', 'ts'], ['admin', 'b'], ['createdBy', 't'], ['usedAt', 'ts'],
    ['usedBy', 't']]
};

const CODE_HOURS = 48;                                  // one-time codes expire after this
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 characters, no 0/O/1/I

// Starting tasks — everything can be edited, archived or added to in the app.
// responsible: a person id, 'DUTY' (whoever is on weekly duty) or '' (nobody yet)
const SEED_TASKS = [
  { key: 'duty_wipe', name: 'Wipe down surfaces', category: 'Cleaning', equipment: 'Hoods, benches, incubator handles', every: 1, unit: 'weeks', responsible: 'DUTY' },
  { key: 'duty_consumables', name: 'Check consumables', category: 'Stock', equipment: 'Shared consumables', every: 1, unit: 'weeks', responsible: 'DUTY', notes: 'Use "Start check" to go through the list and flag what is low.' },
  { key: 'duty_waterbath', name: 'Change water bath', category: 'Cleaning', equipment: 'Water bath', every: 2, unit: 'weeks', responsible: 'DUTY' },
  { key: '', name: 'ContraCon decontamination', category: 'Equipment', equipment: 'Incubator 1', every: 6, unit: 'months', responsible: '' },
  { key: '', name: 'Mycoplasma testing', category: 'Cells', equipment: 'Cell lines in culture', every: 1, unit: 'months', responsible: '', notes: 'Usually done by the technician.' },
  { key: '', name: 'Chromosome abnormality kit test', category: 'Cells', equipment: 'hPSC lines', every: 6, unit: 'months', responsible: '' }
];

const SEED_CONSUMABLES = [
  ['Serological pipettes 5 ml', 'Pipettes & tips'], ['Serological pipettes 10 ml', 'Pipettes & tips'],
  ['Serological pipettes 25 ml', 'Pipettes & tips'], ['Filter tips 10 µl', 'Pipettes & tips'],
  ['Filter tips 200 µl', 'Pipettes & tips'], ['Filter tips 1000 µl', 'Pipettes & tips'],
  ['Aspiration pipettes', 'Pipettes & tips'], ['Falcon tubes 15 ml', 'Tubes'], ['Falcon tubes 50 ml', 'Tubes'],
  ['Eppendorf tubes 1.5 ml', 'Tubes'], ['Cryovials', 'Tubes'], ['6-well plates', 'Plates & dishes'],
  ['12-well plates', 'Plates & dishes'], ['96-well U-bottom low-attachment plates', 'Plates & dishes'],
  ['Nitrile gloves', 'Gloves & PPE'], ['70% ethanol', 'Cleaning'], ['Paper wipes', 'Cleaning']
];

/* ───────────────────────── entry points ───────────────────────── */

function doGet() {
  return json_({ ok: true, app: APP_NAME, message: 'The lab app server is running. Open the app page (GitHub Pages) to use it.' });
}

// Everything the app page may ask for. Each call needs a valid device key.
const ACTIONS = {
  getState: getState_, savePerson: savePerson_, leavePerson: leavePerson_, rejoinPerson: rejoinPerson_,
  saveItem: saveItem_, archiveItem: archiveItem_, addBatch: addBatch_, updateBatch: updateBatch_, useBatch: useBatch_,
  markBatchOpened: markBatchOpened_, finishBatch: finishBatch_, setOrderStatus: setOrderStatus_,
  setConsumableStatus: setConsumableStatus_, submitConsumableCheck: submitConsumableCheck_, saveTask: saveTask_,
  archiveTask: archiveTask_, markTaskDone: markTaskDone_, setDutyPerson: setDutyPerson_, swapDuty: swapDuty_,
  forgetThisDevice: forgetThisDevice_
};
// Only for admin devices.
const ADMIN_ACTIONS = { createCode: createCode_, revokeDevice: revokeDevice_ };

/** The app page sends {action, args, token} as plain text (avoids CORS preflight) and gets JSON back. */
function doPost(e) {
  let out;
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const action = String(req.action || '');
    const args = Array.isArray(req.args) ? req.args : [];
    const has = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };
    if (action === 'pair') {
      out = { ok: true, result: pair_(args[0], args[1]) };
    } else {
      const dev = auth_(req.token);
      let fn = has(ACTIONS, action) ? ACTIONS[action] : null;
      if (!fn && has(ADMIN_ACTIONS, action)) {
        if (!dev.admin) throw new Error('Only admin devices can do this.');
        fn = ADMIN_ACTIONS[action];
      }
      if (!fn) throw new Error('Unknown action: ' + action);
      out = { ok: true, result: fn.apply(null, args) };
    }
  } catch (err) {
    out = { ok: false, error: String((err && err.message) || err), auth: !!(err && err.auth) };
  }
  return json_(out);
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Lab app')
    .addItem('New one-time code (admin device)', 'newAdminCode')
    .addItem('New one-time code (normal device)', 'newDeviceCode')
    .addSeparator()
    .addItem('Set up / repair tabs', 'setup')
    .addItem('Show server (web app) link', 'showWebAppLink')
    .addToUi();
}

function showWebAppLink() {
  const url = ScriptApp.getService().getUrl();
  SpreadsheetApp.getUi().alert(url ? 'Server link (paste into index.html as API_URL):\n\n' + url : 'Not deployed yet: Extensions → Apps Script → Deploy → New deployment → Web app.');
}

function newAdminCode() { showCode_(true); }
function newDeviceCode() { showCode_(false); }
function showCode_(admin) {
  const c = withLock_(function () { return makeCode_(admin, 'Google Sheet'); });
  SpreadsheetApp.getUi().alert('One-time code for ' + (admin ? 'an ADMIN device' : 'a device') + ':\n\n' + c.code +
    '\n\nWorks once, valid for ' + CODE_HOURS + ' hours. Open the app on the new device and enter it.');
}

/** Creates missing tabs, headers and formats, and adds the starting tasks/consumables. Safe to run again. */
function setup() {
  const ss = ss_();
  Object.keys(SCHEMA).forEach(function (name) {
    const sh = ss.getSheetByName(name) || ss.insertSheet(name);
    const cols = SCHEMA[name];
    sh.getRange(1, 1, 1, cols.length).setValues([cols.map(function (c) { return c[0]; })])
      .setFontWeight('bold').setBackground('#e2eee8');
    sh.setFrozenRows(1);
    const fmts = { t: '@', d: 'yyyy-mm-dd', ts: 'yyyy-mm-dd hh:mm' };
    cols.forEach(function (c, i) {
      if (fmts[c[1]]) sh.getRange(2, i + 1, sh.getMaxRows() - 1, 1).setNumberFormat(fmts[c[1]]);
    });
  });
  ['Sheet1', 'Tabellenblatt1', 'Blad1', 'Feuille 1', 'Hoja 1'].forEach(function (n) {
    const s = ss.getSheetByName(n);
    if (s && s.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(s);
  });
  withLock_(seed_);
  const first = withLock_(firstCode_);
  const msg = first ? 'Setup done. Your first one-time code (admin device): ' + first.code + '  – valid ' + CODE_HOURS + ' h, works once.' :
    'Setup done. (Devices already exist – make new codes from the app or the "Lab app" menu.)';
  console.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { /* run from the editor: see the Execution log */ }
  return msg;
}

/** Makes an admin code if no device is set up yet. */
function firstCode_() {
  const devices = readAll_('Devices').filter(function (d) { return !d.revoked; });
  return devices.length ? null : makeCode_(true, 'setup');
}

function seed_() {
  const today = today_();
  if (readAll_('Tasks').length === 0) {
    insertMany_('Tasks', SEED_TASKS.map(function (t) {
      return Object.assign({ id: uid_(), lastDone: '', lastDoneBy: '', notes: '', archived: false, created: today }, t);
    }));
  }
  if (readAll_('Items').filter(function (i) { return i.kind === 'consumable'; }).length === 0) {
    insertMany_('Items', SEED_CONSUMABLES.map(function (c) {
      return { id: uid_(), kind: 'consumable', name: c[0], category: c[1], checkStatus: 'ok', archived: false, created: today };
    }));
  }
}

/* ───────────────────────── read ───────────────────────── */

function getState_() { return withLock_(function () { return state_(); }); }

function state_(result) {
  const today = today_();
  const people = readAll_('People');
  const items = readAll_('Items').filter(function (i) { return !i.archived; });
  const itemIds = {};
  items.forEach(function (i) { itemIds[i.id] = true; });
  const batches = readAll_('Batches').filter(function (b) { return !b.finished && itemIds[b.itemId]; });
  const tasks = readAll_('Tasks').filter(function (t) { return !t.archived; });
  const duty = computeDuty_(people, 10, today);
  return {
    appName: APP_NAME, today: today, thisMonday: monday_(today),
    people: strip_(people), items: strip_(items), batches: strip_(batches), tasks: strip_(tasks),
    duty: duty, log: readLog_(400), result: result === undefined ? null : result,
    device: DEVICE_ ? { id: DEVICE_.id, name: DEVICE_.name, admin: !!DEVICE_.admin } : null,
    devices: DEVICE_ && DEVICE_.admin ? readAll_('Devices').filter(function (d) { return !d.revoked; }).map(function (d) {
      return { id: d.id, name: d.name, admin: d.admin, created: d.created, lastSeen: d.lastSeen, addedBy: d.addedBy };
    }) : []
  };
}

/* ───────────────────────── people ───────────────────────── */

function savePerson_(p, actorId) {
  return mutate_(function () {
    const people = readAll_('People');
    if (p.id) {
      const row = people.find(function (x) { return x.id === p.id; });
      if (!row) throw new Error('Person not found – reload and try again.');
      if ('name' in p) {
        const nm = clean_(p.name);
        if (!nm) throw new Error('Please enter a name.');
        row.name = nm;
      }
      ['email', 'role'].forEach(function (k) { if (k in p) row[k] = clean_(p[k]); });
      ['awayFrom', 'awayUntil', 'endDate'].forEach(function (k) { if (k in p) row[k] = date_(p[k]); });
      if ('inRotation' in p) row.inRotation = !!p.inRotation;
      if (row.awayFrom && row.awayUntil && row.awayUntil < row.awayFrom) throw new Error('"Away until" is before "away from".');
      if (row.awayUntil && !row.awayFrom) row.awayFrom = today_();
      writeRow_('People', row);
      const what = ('awayFrom' in p && !('name' in p)) ?
        (row.awayFrom ? 'Away ' + row.awayFrom + ' – ' + (row.awayUntil || 'open end') : 'Cleared away dates') : 'Updated details';
      log_(nameOf_(actorId, people), what, 'person', row.id, row.name, '');
      return row.id;
    }
    const name = clean_(p.name);
    if (!name) throw new Error('Please enter a name.');
    if (people.some(function (x) { return x.active && x.name.toLowerCase() === name.toLowerCase(); })) {
      throw new Error('"' + name + '" is already on the list.');
    }
    const o = {
      id: uid_(), name: name, email: clean_(p.email), role: clean_(p.role) || 'Member', active: true,
      inRotation: p.inRotation !== false, awayFrom: '', awayUntil: '', endDate: date_(p.endDate),
      joined: today_(), left: ''
    };
    insertMany_('People', [o]);
    const actor = actorId ? nameOf_(actorId, people) : name;
    log_(actor, actor === name ? 'Joined' : 'Added person', 'person', o.id, name, o.role);
    return o.id;
  });
}

function leavePerson_(id, actorId) {
  return mutate_(function () {
    const people = readAll_('People');
    const row = people.find(function (x) { return x.id === id; });
    if (!row) throw new Error('Person not found.');
    row.active = false;
    row.left = today_();
    writeRow_('People', row);
    // drop manual duty assignments to this person from this week on
    const mon = monday_(today_());
    readAll_('Duty').forEach(function (d) {
      if (d.weekStart >= mon && d.overridePersonId === id) { d.overridePersonId = ''; writeRow_('Duty', d); }
    });
    log_(nameOf_(actorId, people), 'Left the lab', 'person', row.id, row.name, '');
  });
}

function rejoinPerson_(id, actorId) {
  return mutate_(function () {
    const people = readAll_('People');
    const row = people.find(function (x) { return x.id === id; });
    if (!row) throw new Error('Person not found.');
    row.active = true;
    row.left = '';
    if (row.endDate && row.endDate < today_()) row.endDate = '';
    writeRow_('People', row);
    log_(nameOf_(actorId, people), 'Back on the list', 'person', row.id, row.name, '');
  });
}

/* ───────────────────────── stocks ───────────────────────── */

const ITEM_TEXT = ['name', 'variant', 'category', 'supplier', 'catalogNo', 'storage', 'temp', 'unit', 'ownerId', 'notes'];
const ITEM_NUM = ['minQty', 'shelfLifeOpenedDays'];

function saveItem_(it, actorId) {
  return mutate_(function () {
    const name = clean_(it.name);
    if (!name) throw new Error('Please enter a name.');
    const actor = nameOf_(actorId);
    if (it.id) {
      const row = findById_('Items', it.id);
      ITEM_TEXT.forEach(function (k) { if (k in it) row[k] = clean_(it[k]); });
      ITEM_NUM.forEach(function (k) { if (k in it) row[k] = num_(it[k]); });
      row.name = name;
      writeRow_('Items', row);
      log_(actor, 'Edited', row.kind, row.id, label_(row), '');
      return row.id;
    }
    const o = {
      id: uid_(), kind: it.kind === 'consumable' ? 'consumable' : 'reagent', orderStatus: '', orderedOn: '',
      orderedBy: '', checkStatus: it.kind === 'consumable' ? 'ok' : '', lastChecked: '', archived: false, created: today_()
    };
    ITEM_TEXT.forEach(function (k) { o[k] = clean_(it[k]); });
    ITEM_NUM.forEach(function (k) { o[k] = num_(it[k]); });
    o.name = name;
    insertMany_('Items', [o]);
    log_(actor, 'Added', o.kind, o.id, label_(o), '');
    const fb = it.firstBatch;
    if (o.kind === 'reagent' && fb && Number(fb.qty) > 0) {
      const b = newBatch_(o, fb);
      log_(actor, 'Received batch', 'reagent', o.id, label_(o), batchText_(o, b));
    }
    return o.id;
  });
}

function archiveItem_(id, actorId) {
  return mutate_(function () {
    const row = findById_('Items', id);
    row.archived = true;
    writeRow_('Items', row);
    log_(nameOf_(actorId), 'Removed from list', row.kind, row.id, label_(row), '');
  });
}

function addBatch_(b, actorId) {
  return mutate_(function () {
    const item = findById_('Items', b.itemId);
    if (!(Number(b.qty) > 0)) throw new Error('Quantity must be more than 0.');
    const o = newBatch_(item, b);
    if (item.orderStatus) {
      item.orderStatus = ''; item.orderedOn = ''; item.orderedBy = '';
      writeRow_('Items', item);
    }
    log_(nameOf_(actorId), 'Received batch', 'reagent', item.id, label_(item), batchText_(item, o));
  });
}

function newBatch_(item, b) {
  const o = {
    id: uid_(), itemId: item.id, lotNo: clean_(b.lotNo), qty: round_(Number(b.qty)), arrived: date_(b.arrived) || today_(),
    expiry: date_(b.expiry), opened: date_(b.opened), notes: clean_(b.notes), finished: false, created: today_()
  };
  insertMany_('Batches', [o]);
  return o;
}

function updateBatch_(b, actorId) {
  return mutate_(function () {
    const row = findById_('Batches', b.id);
    const item = findById_('Items', row.itemId);
    ['lotNo', 'notes'].forEach(function (k) { if (k in b) row[k] = clean_(b[k]); });
    ['arrived', 'expiry', 'opened'].forEach(function (k) { if (k in b) row[k] = date_(b[k]); });
    if ('qty' in b) {
      const q = Number(b.qty);
      if (isNaN(q) || q < 0) throw new Error('Quantity can’t be negative.');
      row.qty = round_(q);
      if (row.qty <= 0) row.finished = true;
    }
    writeRow_('Batches', row);
    log_(nameOf_(actorId), 'Edited batch', 'reagent', item.id, label_(item), batchText_(item, row));
  });
}

function useBatch_(batchId, amount, actorId) {
  return mutate_(function () {
    const b = findById_('Batches', batchId);
    const item = findById_('Items', b.itemId);
    const a = Number(amount) || 1;
    if (a <= 0) throw new Error('Amount must be more than 0.');
    b.qty = round_(Math.max(0, (Number(b.qty) || 0) - a));
    if (b.qty <= 0) b.finished = true;
    writeRow_('Batches', b);
    log_(nameOf_(actorId), 'Used', 'reagent', item.id, label_(item),
      a + ' ' + (item.unit || '') + ' from lot ' + (b.lotNo || '–') + ' · ' + b.qty + ' left in this batch');
  });
}

/** Marks ONE unit (bottle / aliquot) of a batch as opened; the rest of the lot stays sealed. */
function markBatchOpened_(batchId, date, actorId) {
  return mutate_(function () {
    const b = findById_('Batches', batchId);
    const item = findById_('Items', b.itemId);
    const d = date_(date) || today_();
    if (d > today_()) throw new Error('The date can’t be in the future.');
    if ((Number(b.qty) || 0) > 1) {
      b.qty = round_(Number(b.qty) - 1);
      writeRow_('Batches', b);
      insertMany_('Batches', [{ id: uid_(), itemId: b.itemId, lotNo: b.lotNo, qty: 1, arrived: b.arrived, expiry: b.expiry,
        opened: d, notes: b.notes, finished: false, created: today_() }]);
    } else {
      b.opened = d;
      writeRow_('Batches', b);
    }
    log_(nameOf_(actorId), 'Opened / thawed', 'reagent', item.id, label_(item), '1 ' + (item.unit || '') + ' of lot ' + (b.lotNo || '–') + ' on ' + d);
  });
}

function finishBatch_(batchId, actorId) {
  return mutate_(function () {
    const b = findById_('Batches', batchId);
    const item = findById_('Items', b.itemId);
    b.finished = true;
    writeRow_('Batches', b);
    log_(nameOf_(actorId), 'Batch used up / discarded', 'reagent', item.id, label_(item), 'lot ' + (b.lotNo || '–'));
  });
}

function setOrderStatus_(itemId, status, actorId) {
  return mutate_(function () {
    if (['', 'to_order', 'ordered'].indexOf(status) < 0) throw new Error('Unknown status.');
    const item = findById_('Items', itemId);
    const actor = nameOf_(actorId);
    item.orderStatus = status;
    item.orderedOn = status === 'ordered' ? today_() : '';
    item.orderedBy = status === 'ordered' ? actor : '';
    writeRow_('Items', item);
    log_(actor, status === 'ordered' ? 'Ordered' : status === 'to_order' ? 'Flagged to order' : 'Cleared order flag',
      item.kind, item.id, label_(item), '');
  });
}

function setConsumableStatus_(itemId, status, actorId) {
  return mutate_(function () {
    if (['ok', 'low', 'out', 'restocked'].indexOf(status) < 0) throw new Error('Unknown status.');
    const item = findById_('Items', itemId);
    if (status === 'restocked') {
      item.checkStatus = 'ok'; item.orderStatus = ''; item.orderedOn = ''; item.orderedBy = '';
    } else {
      item.checkStatus = status;
    }
    item.lastChecked = today_();
    writeRow_('Items', item);
    const words = { ok: 'Marked OK', low: 'Marked low', out: 'Marked out', restocked: 'Restocked' };
    log_(nameOf_(actorId), words[status], 'consumable', item.id, label_(item), '');
  });
}

/** results: { itemId: 'ok' | 'low' | 'out', ... } */
function submitConsumableCheck_(results, actorId) {
  return mutate_(function () {
    const actor = nameOf_(actorId);
    const today = today_();
    const low = [], out = [];
    readAll_('Items').forEach(function (it) {
      if (it.kind !== 'consumable' || it.archived || !(it.id in results)) return;
      const s = results[it.id];
      if (['ok', 'low', 'out'].indexOf(s) < 0) return;
      it.checkStatus = s;
      it.lastChecked = today;
      writeRow_('Items', it);
      if (s === 'low') low.push(it.name);
      if (s === 'out') out.push(it.name);
    });
    const task = readAll_('Tasks').find(function (t) { return t.key === 'duty_consumables' && !t.archived; });
    if (task) {
      task.lastDone = today; task.lastDoneBy = actor;
      writeRow_('Tasks', task);
    }
    const details = (out.length ? 'Out: ' + out.join(', ') + '. ' : '') + (low.length ? 'Low: ' + low.join(', ') + '.' : '');
    log_(actor, 'Checked consumables', 'task', task ? task.id : '', 'Check consumables', details || 'Everything stocked.');
  });
}

/* ───────────────────────── tasks ───────────────────────── */

function saveTask_(t, actorId) {
  return mutate_(function () {
    const name = clean_(t.name);
    if (!name) throw new Error('Please enter a task name.');
    const every = Number(t.every);
    if (!(every > 0)) throw new Error('"Every" must be a number above 0.');
    if (['days', 'weeks', 'months'].indexOf(t.unit) < 0) throw new Error('Pick days, weeks or months.');
    const actor = nameOf_(actorId);
    if (t.id) {
      const row = findById_('Tasks', t.id);
      row.name = name; row.every = every; row.unit = t.unit;
      ['category', 'equipment', 'responsible', 'notes'].forEach(function (k) { if (k in t) row[k] = clean_(t[k]); });
      writeRow_('Tasks', row);
      log_(actor, 'Edited task', 'task', row.id, taskLabel_(row), 'every ' + every + ' ' + t.unit);
      return row.id;
    }
    const o = {
      id: uid_(), key: '', name: name, category: clean_(t.category), equipment: clean_(t.equipment), every: every,
      unit: t.unit, responsible: clean_(t.responsible), lastDone: date_(t.lastDone), lastDoneBy: '',
      notes: clean_(t.notes), archived: false, created: today_()
    };
    if (o.lastDone && o.lastDone > today_()) throw new Error('"Last done" can’t be in the future.');
    insertMany_('Tasks', [o]);
    log_(actor, 'Added task', 'task', o.id, taskLabel_(o), 'every ' + every + ' ' + t.unit);
    return o.id;
  });
}

function archiveTask_(id, actorId) {
  return mutate_(function () {
    const row = findById_('Tasks', id);
    row.archived = true;
    writeRow_('Tasks', row);
    log_(nameOf_(actorId), 'Removed task', 'task', row.id, taskLabel_(row), '');
  });
}

/** Records that a task was done. The next due date is counted from the most recent "done" date. */
function markTaskDone_(id, date, note, actorId) {
  return mutate_(function () {
    const t = findById_('Tasks', id);
    const today = today_();
    const d = date_(date) || today;
    if (d > today) throw new Error('The date can’t be in the future.');
    const actor = nameOf_(actorId);
    if (!t.lastDone || d >= t.lastDone) { t.lastDone = d; t.lastDoneBy = actor; }
    writeRow_('Tasks', t);
    log_(actor, 'Done', 'task', t.id, taskLabel_(t), (d !== today ? 'on ' + d + '. ' : '') + clean_(note));
  });
}

/* ───────────────────────── weekly duty rotation ───────────────────────── */

/** Put someone else on duty for one week ('' = back to the automatic rotation). */
function setDutyPerson_(weekStart, personId, actorId) {
  return mutate_(function () {
    const w = date_(weekStart);
    if (!w || monday_(w) !== w) throw new Error('Not a valid week.');
    const people = readAll_('People');
    const sched = computeDuty_(people, 26, today_());
    const wk = sched.find(function (x) { return x.weekStart === w; });
    if (!wk) throw new Error('You can only change the next 26 weeks.');
    setOverride_(w, personId === wk.baseId ? '' : personId);
    log_(nameOf_(actorId, people), 'Changed weekly duty', 'duty', w, 'Week of ' + w,
      personId ? nameOf_(personId, people) : 'back to automatic (' + nameOf_(wk.baseId, people) + ')');
  });
}

/** Swap the people on duty in two weeks. */
function swapDuty_(weekA, weekB, actorId) {
  return mutate_(function () {
    const people = readAll_('People');
    const sched = computeDuty_(people, 26, today_());
    const a = sched.find(function (x) { return x.weekStart === weekA; });
    const b = sched.find(function (x) { return x.weekStart === weekB; });
    if (!a || !b || a === b) throw new Error('Pick two different weeks.');
    setOverride_(a.weekStart, b.personId === a.baseId ? '' : b.personId);
    setOverride_(b.weekStart, a.personId === b.baseId ? '' : a.personId);
    log_(nameOf_(actorId, people), 'Swapped weekly duty', 'duty', a.weekStart, 'Weeks of ' + a.weekStart + ' and ' + b.weekStart,
      nameOf_(a.personId, people) + ' ⇄ ' + nameOf_(b.personId, people));
  });
}

function setOverride_(w, personId) {
  const row = readAll_('Duty').find(function (r) { return r.weekStart === w; });
  if (row) { row.overridePersonId = personId || ''; writeRow_('Duty', row); }
  else if (personId) insertMany_('Duty', [{ weekStart: w, basePersonId: '', overridePersonId: personId }]);
}

/**
 * One person per week (Mon–Sun), going round the People list in sheet order.
 * Skips people who left, are not in the rotation, or are away 3+ weekdays that week.
 * Past and current weeks are written to the Duty tab so they don't shift when people join;
 * future weeks are calculated. Manual changes are stored as overrides.
 */
function computeDuty_(people, weeks, today) {
  const thisMon = monday_(today);
  const endWeek = addDays_(thisMon, 7 * (weeks - 1));
  const rows = readAll_('Duty');
  const byWeek = {};
  rows.forEach(function (r) { if (r.weekStart) byWeek[r.weekStart] = r; });
  const finals = rows.filter(function (r) { return r.basePersonId && r.weekStart && r.weekStart <= thisMon; })
    .map(function (r) { return r.weekStart; }).sort();
  // if this week's person can't do it any more (left / away / out of rotation), recalculate this week
  if (finals.length && finals[finals.length - 1] === thisMon) {
    const bp = people.find(function (p) { return p.id === byWeek[thisMon].basePersonId; });
    if (!bp || !eligible_(bp, thisMon)) finals.pop();
  }
  const lastFinal = finals.length ? finals[finals.length - 1] : '';
  let prevBase = lastFinal ? byWeek[lastFinal].basePersonId : '';
  let w = lastFinal ? addDays_(lastFinal, 7) : thisMon;
  const earliest = addDays_(thisMon, -7 * 52);
  if (w < earliest) w = earliest;
  const computed = {};
  const toAppend = [];
  while (w <= endWeek) {
    const p = nextEligible_(people, prevBase, w);
    const base = p ? p.id : '';
    const row = byWeek[w];
    if (w <= thisMon) {
      if (row) { if (row.basePersonId !== base) { row.basePersonId = base; writeRow_('Duty', row); } }
      else toAppend.push({ weekStart: w, basePersonId: base, overridePersonId: '' });
    }
    computed[w] = base;
    if (base) prevBase = base;
    w = addDays_(w, 7);
  }
  insertMany_('Duty', toAppend);
  const out = [];
  for (let i = 0; i < weeks; i++) {
    const wk = addDays_(thisMon, 7 * i);
    const row = byWeek[wk];
    const base = (wk in computed) ? computed[wk] : (row ? row.basePersonId : '');
    const ov = row && row.overridePersonId ? row.overridePersonId : '';
    out.push({ weekStart: wk, baseId: base, personId: ov || base, changed: !!ov && ov !== base });
  }
  return out;
}

function nextEligible_(people, prevId, w) {
  const n = people.length;
  if (!n) return null;
  const idx = people.findIndex(function (p) { return p.id === prevId; });
  for (let k = 1; k <= n; k++) {
    const p = people[(idx + k + n) % n];
    if (eligible_(p, w)) return p;
  }
  return null;
}

function eligible_(p, w) {
  if (!p.active || p.left || !p.inRotation) return false;
  const fri = addDays_(w, 4);
  if (p.endDate && p.endDate < w) return false;
  if (p.joined && p.joined > fri) return false;
  if (p.awayFrom) {
    const from = p.awayFrom > w ? p.awayFrom : w;
    const to = p.awayUntil && p.awayUntil < fri ? p.awayUntil : fri;
    if (from <= to && diffDays_(to, from) + 1 >= 3) return false;
  }
  return true;
}

/* ───────────────────────── devices & one-time codes ───────────────────────── */

let DEVICE_ = null; // the device making the current request

function authErr_(msg) { const e = new Error(msg); e.auth = true; return e; }

function auth_(token) {
  if (!token || typeof token !== 'string' || token.length < 32) throw authErr_('This device isn’t set up yet.');
  const h = hash_(token);
  const d = readAll_('Devices').find(function (x) { return x.tokenHash === h; });
  if (!d) throw authErr_('This device isn’t set up yet.');
  if (d.revoked) throw authErr_('This device was removed from the app. Ask an admin for a new one-time code.');
  const today = today_();
  if (d.lastSeen !== today) withLock_(function () { d.lastSeen = today; writeRow_('Devices', d); });
  DEVICE_ = d;
  return d;
}

/** Exchanges a one-time code for a long random device key. Only the key's hash is stored. */
function pair_(code, name) {
  const cache = CacheService.getScriptCache();
  const fails = Number(cache.get('pairFails') || 0);
  if (fails >= 20) throw new Error('Too many wrong codes. Please wait 15 minutes and try again.');
  const devName = clean_(name).slice(0, 60);
  if (!devName) throw new Error('Please give this device a name, e.g. “Lab iPad” or “Munisa’s phone”.');
  const norm = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const h = hash_(norm);
  return withLock_(function () {
    const c = norm.length === 8 ? readAll_('Codes').find(function (x) { return x.codeHash === h; }) : null;
    if (!c || c.usedAt || c.expires < stamp_()) {
      cache.put('pairFails', String(fails + 1), 900);
      Utilities.sleep(1200);
      throw new Error(!c ? 'That code isn’t right. Check it and try again.' :
        c.usedAt ? 'This code was already used – each code works only once. Ask for a new one.' : 'This code has expired. Ask for a new one.');
    }
    const token = newToken_();
    const dev = { id: uid_(), name: devName, tokenHash: hash_(token), admin: !!c.admin, created: new Date(),
      lastSeen: today_(), revoked: false, addedBy: c.createdBy };
    insertMany_('Devices', [dev]);
    c.usedAt = new Date();
    c.usedBy = devName;
    writeRow_('Codes', c);
    DEVICE_ = dev;
    log_('New device', 'Device set up', 'device', dev.id, devName, (dev.admin ? 'admin device · ' : '') + 'code from ' + (c.createdBy || '?'));
    return { token: token, device: { id: dev.id, name: dev.name, admin: dev.admin } };
  });
}

function makeCode_(admin, by) {
  const code = newCode_();
  insertMany_('Codes', [{ codeHash: hash_(code), created: new Date(), expires: new Date(Date.now() + CODE_HOURS * 3600e3),
    admin: !!admin, createdBy: by, usedAt: '', usedBy: '' }]);
  log_(by, 'Created one-time code', 'device', '', admin ? 'for an admin device' : 'for a device', 'valid ' + CODE_HOURS + ' h');
  return { code: code.slice(0, 4) + '-' + code.slice(4), hours: CODE_HOURS, admin: !!admin };
}

function createCode_(admin, actorId) {
  return mutate_(function () {
    return makeCode_(!!admin, nameOf_(actorId) + ' (' + DEVICE_.name + ')');
  });
}

function revokeDevice_(id, actorId) {
  return mutate_(function () {
    const d = findById_('Devices', id);
    d.revoked = true;
    writeRow_('Devices', d);
    log_(nameOf_(actorId), 'Removed device', 'device', d.id, d.name, '');
  });
}

function forgetThisDevice_(actorId) {
  return withLock_(function () {
    const d = findById_('Devices', DEVICE_.id);
    d.revoked = true;
    writeRow_('Devices', d);
    log_(nameOf_(actorId), 'Signed out device', 'device', d.id, d.name, '');
    return true;
  });
}

function hash_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
}
function randHex_() { return Utilities.getUuid().replace(/-/g, '').slice(0, 12); } // 12 fully random hex digits
function newToken_() { let t = ''; for (let i = 0; i < 6; i++) t += randHex_(); return t; }
function newCode_() {
  const hex = randHex_() + randHex_();
  let s = '';
  for (let i = 0; i < 8; i++) s += CODE_ALPHABET.charAt(parseInt(hex.substr(i * 2, 2), 16) % 32);
  return s;
}
function stamp_() { return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm'); }

/* ───────────────────────── sheet helpers ───────────────────────── */

let SS_ = null, TZ_ = null;
function ss_() { return SS_ || (SS_ = SpreadsheetApp.getActive()); }
function tz_() { return TZ_ || (TZ_ = ss_().getSpreadsheetTimeZone() || Session.getScriptTimeZone()); }

function sheet_(name) {
  const sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('The "' + name + '" tab is missing. Open the Sheet → Lab app → Set up / repair tabs.');
  return sh;
}

function readAll_(name) {
  const sh = sheet_(name), cols = SCHEMA[name], last = sh.getLastRow();
  if (last < 2) return [];
  const vals = sh.getRange(2, 1, last - 1, cols.length).getValues();
  const out = [];
  vals.forEach(function (r, i) {
    if (r.every(function (v) { return v === '' || v === null; })) return;
    const o = { _row: i + 2 };
    cols.forEach(function (c, j) { o[c[0]] = decode_(r[j], c[1]); });
    out.push(o);
  });
  return out;
}

function readLog_(n) {
  const sh = sheet_('Log'), cols = SCHEMA.Log, last = sh.getLastRow();
  if (last < 2) return [];
  const start = Math.max(2, last - n + 1);
  return sh.getRange(start, 1, last - start + 1, cols.length).getValues().reverse().map(function (r) {
    const o = {};
    cols.forEach(function (c, j) { o[c[0]] = decode_(r[j], c[1]); });
    return o;
  });
}

function insertMany_(name, objs) {
  if (!objs.length) return;
  const sh = sheet_(name), cols = SCHEMA[name];
  const start = sh.getLastRow() + 1;
  const need = start + objs.length - 1;
  if (need > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), need - sh.getMaxRows() + 200);
  sh.getRange(start, 1, objs.length, cols.length).setValues(objs.map(function (o) { return rowOf_(name, o); }));
}

function writeRow_(name, o) {
  sheet_(name).getRange(o._row, 1, 1, SCHEMA[name].length).setValues([rowOf_(name, o)]);
}

function findById_(name, id) {
  const r = readAll_(name).find(function (x) { return x.id === id; });
  if (!r) throw new Error('Not found – someone may have just changed it. Reload and try again.');
  return r;
}

function rowOf_(name, o) { return SCHEMA[name].map(function (c) { return encode_(o[c[0]], c[1]); }); }

function isDate_(v) { return Object.prototype.toString.call(v) === '[object Date]'; }

function decode_(v, t) {
  if (t === 'b') return v === true || String(v).toUpperCase() === 'TRUE';
  if (v === null || v === undefined || v === '') return '';
  if (isDate_(v)) {
    if (isNaN(v.getTime())) return '';
    return Utilities.formatDate(v, tz_(), t === 'ts' ? 'yyyy-MM-dd HH:mm' : 'yyyy-MM-dd');
  }
  if (t === 'n') { const n = Number(v); return isNaN(n) ? '' : n; }
  let s = String(v);
  if (s.charAt(0) === "'" && s.charAt(1) === '=') s = s.slice(1);
  return s;
}

function encode_(v, t) {
  if (t === 'b') return v === true || v === 'true' || v === 'TRUE';
  if (v === null || v === undefined) return '';
  if (t === 'n') { if (v === '') return ''; const n = Number(v); return isNaN(n) ? '' : n; }
  if (t === 'ts') return isDate_(v) ? v : String(v);
  if (t === 'd') return date_(v);
  let s = String(v);
  if (s.charAt(0) === '=') s = "'" + s; // never let text turn into a formula
  return s;
}

function strip_(rows) {
  return rows.map(function (o) { const c = Object.assign({}, o); delete c._row; return c; });
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try { return fn(); } finally { lock.releaseLock(); }
}

/** Runs a change under a lock, then returns the fresh state for the app. */
function mutate_(fn) {
  return withLock_(function () {
    const result = fn();
    SpreadsheetApp.flush();
    return state_(result);
  });
}

function log_(person, action, targetType, targetId, target, details) {
  insertMany_('Log', [{ timestamp: new Date(), person: person, action: action, targetType: targetType,
    targetId: targetId, target: target, details: details || '', device: DEVICE_ ? DEVICE_.name : 'Google Sheet' }]);
}

function nameOf_(id, people) {
  if (!id) return 'Someone';
  const p = (people || readAll_('People')).find(function (x) { return x.id === id; });
  return p ? p.name : 'Someone';
}

function label_(item) { return item.name + (item.variant ? ' (' + item.variant + ')' : ''); }
function taskLabel_(t) { return t.name + (t.equipment ? ' – ' + t.equipment : ''); }
function batchText_(item, b) {
  return b.qty + ' ' + (item.unit || '') + ' · lot ' + (b.lotNo || '–') + ' · expires ' + (b.expiry || '–');
}

function clean_(s) { return s === null || s === undefined ? '' : String(s).trim().slice(0, 500); }
function num_(v) { if (v === '' || v === null || v === undefined) return ''; const n = Number(v); return isNaN(n) || n < 0 ? '' : n; }
function round_(n) { return Math.round(n * 1000) / 1000; }
function uid_() { return Utilities.getUuid().replace(/-/g, '').slice(0, 12); }

/* dates are handled as 'yyyy-MM-dd' strings in the spreadsheet's time zone */
function today_() { return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd'); }
function date_(v) {
  if (v === null || v === undefined || v === '') return '';
  if (isDate_(v)) return isNaN(v.getTime()) ? '' : Utilities.formatDate(v, tz_(), 'yyyy-MM-dd');
  const s = String(v).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}
function p_(s) { const a = s.split('-').map(Number); return Date.UTC(a[0], a[1] - 1, a[2]); }
function f_(t) { return new Date(t).toISOString().slice(0, 10); }
function addDays_(s, n) { return f_(p_(s) + n * 864e5); }
function diffDays_(a, b) { return Math.round((p_(a) - p_(b)) / 864e5); }
function monday_(s) { const t = p_(s); const dow = (new Date(t).getUTCDay() + 6) % 7; return f_(t - dow * 864e5); }
