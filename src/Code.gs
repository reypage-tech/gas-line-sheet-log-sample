/**
 * LINE公式アカウントの1対1トークをスプレッドシートへ転記する（見本）
 * - 受信: Webhook（doPost）で受けたメッセージを1行ずつ書く
 * - 送信: 担当者がシートの「LINE送信」メニューか送信画面から送ると、送った内容も同時に書く
 * - 送り先: 表示名で選び、「送り先」シートで相手IDを引く
 * - 画像: 受信画像はドライブへ保存してURLを書く。送る画像は公開URLで渡す
 * 列: 既存シートの並び（受信時刻・ユーザー名・受信メッセージ・画像URL）は変えず、足す列は右に置く。
 * トークンなどはスクリプトプロパティに置き、コードには書かない。
 */
var CONFIG = {
  SHEET_NAME: 'トーク履歴',
  BASE_HEADER: ['受信時刻', 'ユーザー名', '受信メッセージ', '画像URL'],
  EXTRA_HEADER: ['向き', '種類', '相手ID', 'メッセージID', 'イベントID'],
  CONTACT_SHEET: '送り先',
  CONTACT_HEADER: ['表示名', '相手ID'],
  SEND_SHEET: '送信',
  SEND_HEADER: ['表示名', '本文', '画像URL', '状態'],
  PROP_TOKEN: 'LINE_CHANNEL_ACCESS_TOKEN',
  PROP_SHEET_ID: 'SHEET_ID',
  PROP_FOLDER_ID: 'IMAGE_FOLDER_ID'
};

function getProp_(key) {
  var v = PropertiesService.getScriptProperties().getProperty(key);
  if (!v) throw new Error('スクリプトプロパティ未設定: ' + key);
  return v;
}

/** 日時はスクリプトのタイムゾーンで書く */
function formatTime_(ms) {
  return Utilities.formatDate(new Date(ms), Session.getScriptTimeZone(), 'yyyy/MM/dd HH:mm:ss');
}

function getBook_() { return SpreadsheetApp.openById(getProp_(CONFIG.PROP_SHEET_ID)); }

function getNamedSheet_(name, header) {
  var ss = getBook_();
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sh.getLastRow() === 0) sh.appendRow(header);
  return sh;
}

/** 既存の4列はそのまま。足す列の見出しが無ければ右（5列目以降）に足す */
function getSheet_() {
  var sh = getNamedSheet_(CONFIG.SHEET_NAME, CONFIG.BASE_HEADER.concat(CONFIG.EXTRA_HEADER));
  var base = CONFIG.BASE_HEADER.length;
  if (sh.getLastColumn() < base + CONFIG.EXTRA_HEADER.length) {
    sh.getRange(1, base + 1, 1, CONFIG.EXTRA_HEADER.length).setValues([CONFIG.EXTRA_HEADER]);
  }
  return sh;
}

/** 1行の並び: 既存4列 + 足す列 */
function logRow_(time, name, text, imageUrl, dir, kind, uid, messageId, eventId) {
  getSheet_().appendRow([time, name, text, imageUrl, dir, kind, uid, messageId || '', eventId || '']);
}

/** 同じイベントの再送（LINE側のリトライ）で二重に書かない */
function isDuplicate_(eventId) {
  if (!eventId) return false;
  var cache = CacheService.getScriptCache();
  if (cache.get('ev_' + eventId)) return true;
  cache.put('ev_' + eventId, '1', 21600);
  return false;
}

var nameCache_ = {};
function getDisplayName_(userId) {
  if (!userId) return '';
  if (nameCache_[userId] !== undefined) return nameCache_[userId];
  var name = '';
  try {
    var res = UrlFetchApp.fetch('https://api.line.me/v2/bot/profile/' + encodeURIComponent(userId), {
      headers: { Authorization: 'Bearer ' + getProp_(CONFIG.PROP_TOKEN) },
      muteHttpExceptions: true
    });
    if (res.getResponseCode() === 200) name = JSON.parse(res.getContentText()).displayName || '';
  } catch (err) { console.warn('profile取得失敗: ' + err); }
  nameCache_[userId] = name;
  return name;
}

/** 受信画像をLINEから取得してドライブに保存し、URLを返す */
function saveImage_(messageId, timestampMs) {
  var res = UrlFetchApp.fetch('https://api-data.line.me/v2/bot/message/' + messageId + '/content', {
    headers: { Authorization: 'Bearer ' + getProp_(CONFIG.PROP_TOKEN) },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) return '取得失敗(' + res.getResponseCode() + ')';
  var stamp = Utilities.formatDate(new Date(timestampMs), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss');
  var blob = res.getBlob().setName(stamp + '_' + messageId + '.jpg');
  var file = DriveApp.getFolderById(getProp_(CONFIG.PROP_FOLDER_ID)).createFile(blob);
  return file.getUrl();
}

function describe_(m) {
  switch (m.type) {
    case 'text': return { kind: 'テキスト', body: m.text };
    case 'image': return { kind: '画像', body: '' };
    case 'sticker': return { kind: 'スタンプ', body: 'スタンプ(' + m.packageId + '/' + m.stickerId + ')' };
    default: return { kind: m.type, body: '(' + m.type + ')' };
  }
}

/* ---------- 送り先（表示名と相手ID） ---------- */

function readContacts_() {
  var values = getNamedSheet_(CONFIG.CONTACT_SHEET, CONFIG.CONTACT_HEADER).getDataRange().getValues();
  return values.slice(1).filter(function (r) { return r[0] && r[1]; })
    .map(function (r) { return { name: String(r[0]), userId: String(r[1]) }; });
}

/** 受信したときに送り先へ登録する（同じ相手IDは1行だけ） */
function upsertContact_(name, userId) {
  if (!userId) return;
  var exists = readContacts_().some(function (c) { return c.userId === userId; });
  if (!exists) getNamedSheet_(CONFIG.CONTACT_SHEET, CONFIG.CONTACT_HEADER).appendRow([name || userId, userId]);
}

/** 表示名から相手IDを引く。見つからない・同じ名前が2人以上ならエラーにする */
function findUserId_(name) {
  var hit = readContacts_().filter(function (c) { return c.name === name; });
  if (hit.length === 0) throw new Error('送り先に無い表示名です: ' + name);
  if (hit.length > 1) throw new Error('同じ表示名が' + hit.length + '人います。送り先シートで名前を分けてください: ' + name);
  return hit[0].userId;
}

/** 送信画面のプルダウン用 */
function getContactNames() {
  return readContacts_().map(function (c) { return c.name; });
}

/* ---------- 受信 ---------- */

/** Webhookの入口 */
function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var body = JSON.parse(e.postData.contents);
    (body.events || []).forEach(function (ev) {
      if (ev.type !== 'message') return;
      if (isDuplicate_(ev.webhookEventId)) return;
      var uid = ev.source && ev.source.userId;
      var name = getDisplayName_(uid);
      var d = describe_(ev.message);
      var link = ev.message.type === 'image' ? saveImage_(ev.message.id, ev.timestamp) : '';
      logRow_(formatTime_(ev.timestamp), name, d.body, link, '受信', d.kind, uid, ev.message.id, ev.webhookEventId);
      upsertContact_(name, uid);
    });
  } finally {
    lock.releaseLock();
  }
  return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON);
}

/* ---------- 送信（送ると同時に記録） ---------- */

/**
 * 送信して、送った内容をシートに書く。
 * mode: 'push'（to=userId）または 'reply'（to=replyToken, userIdは別に渡す）
 */
function sendAndLog_(mode, to, messages, userIdForLog) {
  var url = mode === 'reply' ? 'https://api.line.me/v2/bot/message/reply' : 'https://api.line.me/v2/bot/message/push';
  var payload = mode === 'reply' ? { replyToken: to, messages: messages } : { to: to, messages: messages };
  var res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + getProp_(CONFIG.PROP_TOKEN) },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  var uid = mode === 'reply' ? userIdForLog : to;
  var now = formatTime_(Date.now());
  var dir = code === 200 ? '送信' : '送信失敗(' + code + ')';
  messages.forEach(function (m) {
    var d = describe_(m);
    logRow_(now, getDisplayName_(uid), d.body, m.type === 'image' ? m.originalContentUrl : '', dir, d.kind, uid);
  });
  return code;
}

function pushAndLog(userId, messages) { return sendAndLog_('push', userId, messages, userId); }
function replyAndLog(replyToken, userId, messages) { return sendAndLog_('reply', replyToken, messages, userId); }

/**
 * ドライブの画像を送るときのURL。LINEは https の公開URLしか受け付けないため、
 * ファイルを「リンクを知っている全員が閲覧可」にする必要がある（共有の範囲は要相談）。
 */
function driveImageUrl_(fileId) {
  return 'https://drive.google.com/uc?export=view&id=' + encodeURIComponent(fileId);
}

/** 本文と画像URLからメッセージを組む。画像URLはドライブのファイルIDでも可 */
function buildMessages_(text, image) {
  var msgs = [];
  if (text) msgs.push({ type: 'text', text: String(text) });
  if (image) {
    var url = /^https:\/\//.test(image) ? image : driveImageUrl_(image);
    msgs.push({ type: 'image', originalContentUrl: url, previewImageUrl: url });
  }
  if (msgs.length === 0) throw new Error('本文か画像URLのどちらかを入れてください');
  return msgs;
}

/** 表示名を選んで送る（送信画面と送信シートの共通の入口） */
function sendByName(name, text, image) {
  var uid = findUserId_(name);
  var code = pushAndLog(uid, buildMessages_(text, image));
  return code === 200 ? '送信済み' : '送信失敗(' + code + ')';
}

/** 「送信」シートで状態が空の行を上から送り、状態を書く */
function sendFromSheet() {
  var sh = getNamedSheet_(CONFIG.SEND_SHEET, CONFIG.SEND_HEADER);
  var values = sh.getDataRange().getValues();
  var sent = 0;
  for (var i = 1; i < values.length; i++) {
    var r = values[i];
    if (r[3] || (!r[1] && !r[2])) continue;
    var status;
    try { status = sendByName(String(r[0]), r[1], r[2]); } catch (err) { status = 'エラー: ' + err.message; }
    sh.getRange(i + 1, 4).setValue(status + ' ' + formatTime_(Date.now()));
    sent++;
  }
  return sent;
}

/** シートを開いたときにメニューを出す */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('LINE送信')
    .addItem('送信画面を開く', 'openSendDialog')
    .addItem('送信シートの未送信を送る', 'sendFromSheet')
    .addToUi();
}

function openSendDialog() {
  var html = HtmlService.createHtmlOutputFromFile('Dialog').setWidth(420).setHeight(380);
  SpreadsheetApp.getUi().showModalDialog(html, 'LINEで送る');
}
