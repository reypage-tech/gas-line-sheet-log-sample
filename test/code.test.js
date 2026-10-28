const test = require('node:test'); const assert = require('node:assert');
const { load } = require('./mock'); const ev = require('../sample_data/webhook_events.json');
const post = (env, body) => env.ctx.doPost({ postData: { contents: JSON.stringify(body) } });
const profiles = { Udemo0001: '架空顧客A', Udemo0002: '架空顧客B' };
const J = x => JSON.parse(JSON.stringify(x));
const HEAD = ['受信時刻', 'ユーザー名', '受信メッセージ', '画像URL', '向き', '種類', '相手ID', 'メッセージID', 'イベントID'];

test('見出しは既存の4列（受信時刻・ユーザー名・受信メッセージ・画像URL）が先頭で、足す列は右', () => {
  const env = load({ profiles }); post(env, ev);
  assert.deepStrictEqual(J(env.rows[0]), HEAD);
  assert.strictEqual(env.rows.length, 4); // 見出し+3件（followは対象外）
  assert.deepStrictEqual(J(env.rows[1].slice(1, 7)), ['架空顧客A', '見積もりの件で質問があります', '', '受信', 'テキスト', 'Udemo0001']);
});
test('既存の4列だけのシートは、4列を動かさず5列目から見出しを足す', () => {
  const old = [['受信時刻', 'ユーザー名', '受信メッセージ', '画像URL'], ['2026/10/27 09:00:00', '架空顧客C', '既存の行', '']];
  const env = load({ profiles, sheets: { 'トーク履歴': old } }); post(env, ev);
  assert.deepStrictEqual(J(env.rows[0]), HEAD);
  assert.deepStrictEqual(J(env.rows[1]), old[1]);
  assert.strictEqual(env.rows[2][1], '架空顧客A');
});
test('日時はスクリプトのタイムゾーン（Asia/Tokyo）で書かれる', () => {
  const env = load({ profiles }); post(env, ev);
  assert.strictEqual(env.rows[1][0], '2026/10/28 10:00:00');
});
test('タイムゾーンを変えると表示も変わる（UTC）', () => {
  const env = load({ profiles, tz: 'UTC' }); post(env, ev);
  assert.strictEqual(env.rows[1][0], '2026/10/28 01:00:00');
});
test('受信画像はドライブに保存され、画像URL列（4列目）に書かれる', () => {
  const env = load({ profiles }); post(env, ev);
  assert.strictEqual(env.files.length, 1);
  assert.match(env.files[0].name, /^20261028_100100_m002\.jpg$/);
  assert.strictEqual(env.rows[2][3], 'https://drive.google.com/file/d/file1/view');
  assert.ok(env.fetches.some(f => f.url === 'https://api-data.line.me/v2/bot/message/m002/content'));
});
test('画像の取得に失敗したら理由を残して処理を続ける', () => {
  const env = load({ profiles, contentCode: 404 }); post(env, ev);
  assert.strictEqual(env.rows[2][3], '取得失敗(404)'); assert.strictEqual(env.rows.length, 4);
});
test('スタンプは種類と番号を書く', () => {
  const env = load({ profiles }); post(env, ev);
  assert.strictEqual(env.rows[3][2], 'スタンプ(446/1988)'); assert.strictEqual(env.rows[3][5], 'スタンプ');
});
test('同じイベントIDの再送は二重に書かない', () => {
  const env = load({ profiles }); post(env, ev); post(env, ev);
  assert.strictEqual(env.rows.length, 4);
});
test('受信した相手は「送り先」シートに表示名と相手IDで1回だけ登録される', () => {
  const env = load({ profiles }); post(env, ev);
  assert.deepStrictEqual(J(env.sheet('送り先')), [['表示名', '相手ID'], ['架空顧客A', 'Udemo0001'], ['架空顧客B', 'Udemo0002']]);
});
test('表示名で選んで送ると、相手IDに送られ、同時に「送信」行が書かれる', () => {
  const env = load({ profiles }); post(env, ev);
  assert.strictEqual(env.ctx.sendByName('架空顧客B', 'ご連絡ありがとうございます', ''), '送信済み');
  const f = env.fetches.find(x => x.url.endsWith('/push'));
  assert.strictEqual(JSON.parse(f.o.payload).to, 'Udemo0002');
  const last = env.rows[env.rows.length - 1];
  assert.deepStrictEqual(J(last.slice(1, 7)), ['架空顧客B', 'ご連絡ありがとうございます', '', '送信', 'テキスト', 'Udemo0002']);
});
test('画像を送る例: 公開URLの画像は本文と一緒に送られ、画像URL列に記録される', () => {
  const env = load({ profiles }); post(env, ev);
  env.ctx.sendByName('架空顧客A', 'お見積書です', 'https://example.com/demo/estimate.jpg');
  const p = JSON.parse(env.fetches.filter(x => x.url.endsWith('/push')).pop().o.payload);
  assert.deepStrictEqual(J(p.messages[1]), { type: 'image', originalContentUrl: 'https://example.com/demo/estimate.jpg', previewImageUrl: 'https://example.com/demo/estimate.jpg' });
  const last = env.rows[env.rows.length - 1];
  assert.deepStrictEqual(J(last.slice(3, 6)), ['https://example.com/demo/estimate.jpg', '送信', '画像']);
});
test('画像欄にドライブのファイルIDを入れると、ドライブの表示用URLにして送る', () => {
  const env = load({ profiles }); post(env, ev);
  env.ctx.sendByName('架空顧客A', '', 'demoFileId123');
  const p = JSON.parse(env.fetches.filter(x => x.url.endsWith('/push')).pop().o.payload);
  assert.strictEqual(p.messages[0].originalContentUrl, 'https://drive.google.com/uc?export=view&id=demoFileId123');
});
test('送り先に無い表示名・同じ表示名が2人はエラーで止まり、送らない', () => {
  const env = load({ profiles, sheets: { '送り先': [['表示名', '相手ID'], ['架空顧客A', 'Udemo0001'], ['架空顧客A', 'Udemo0009']] } });
  assert.throws(() => env.ctx.sendByName('架空顧客Z', 'x', ''), /送り先に無い/);
  assert.throws(() => env.ctx.sendByName('架空顧客A', 'x', ''), /同じ表示名が2人/);
  assert.ok(!env.fetches.some(x => x.url.endsWith('/push')));
});
test('本文も画像も空なら送らない', () => {
  const env = load({ profiles }); post(env, ev);
  assert.throws(() => env.ctx.sendByName('架空顧客A', '', ''), /本文か画像URL/);
});
test('送信シート: 状態が空の行だけ送り、状態に結果を書く', () => {
  const env = load({ profiles, sheets: { '送信': [['表示名', '本文', '画像URL', '状態'], ['架空顧客A', '済みの行', '', '送信済み 2026/10/27 10:00:00'], ['架空顧客A', 'こちらを送る', 'https://example.com/demo/a.jpg', ''], ['架空顧客Z', '宛先なし', '', '']] } });
  post(env, ev);
  assert.strictEqual(env.ctx.sendFromSheet(), 2);
  const s = env.sheet('送信');
  assert.match(s[2][3], /^送信済み 2026\//); assert.match(s[3][3], /^エラー: 送り先に無い表示名/);
  assert.strictEqual(env.fetches.filter(x => x.url.endsWith('/push')).length, 1);
  assert.strictEqual(env.rows.length, 6); // 受信3+送信2（本文と画像）
});
test('シートを開くと「LINE送信」メニューが出て、送信画面を開ける', () => {
  const env = load({ profiles }); env.ctx.onOpen();
  assert.strictEqual(env.ui.menus[0].title, 'LINE送信');
  assert.deepStrictEqual(J(env.ui.menus[0].items.map(i => i[1])), ['openSendDialog', 'sendFromSheet']);
  env.ctx.openSendDialog(); assert.strictEqual(env.ui.dialogs[0].file, 'Dialog');
});
test('送信画面のプルダウンは送り先の表示名を出す', () => {
  const env = load({ profiles }); post(env, ev);
  assert.deepStrictEqual(J(env.ctx.getContactNames()), ['架空顧客A', '架空顧客B']);
});
test('返信（reply）も相手IDつきで「送信」として書かれる', () => {
  const env = load({ profiles }); env.ctx.replyAndLog('rt003', 'Udemo0002', [{ type: 'text', text: 'ありがとうございます' }]);
  assert.deepStrictEqual(J(env.rows[1].slice(1, 7)), ['架空顧客B', 'ありがとうございます', '', '送信', 'テキスト', 'Udemo0002']);
  assert.strictEqual(JSON.parse(env.fetches.find(x => x.url.endsWith('/reply')).o.payload).replyToken, 'rt003');
});
test('送信に失敗したら「送信失敗(コード)」と書く', () => {
  const env = load({ profiles, sendCode: 400 }); post(env, ev);
  assert.strictEqual(env.ctx.sendByName('架空顧客A', 'テスト', ''), '送信失敗(400)');
  assert.strictEqual(env.rows[env.rows.length - 1][4], '送信失敗(400)');
});
test('表示名が取れない相手は空欄で書き、送り先には相手IDで登録する', () => {
  const env = load({ profiles: {} }); post(env, ev);
  assert.strictEqual(env.rows[1][1], '');
  assert.deepStrictEqual(J(env.sheet('送り先')[1]), ['Udemo0001', 'Udemo0001']);
});
test('トークンが未設定ならはっきりしたエラーで止まる', () => {
  const env = load({ props: { LINE_CHANNEL_ACCESS_TOKEN: '' } });
  assert.throws(() => env.ctx.pushAndLog('Udemo0001', [{ type: 'text', text: 'x' }]), /LINE_CHANNEL_ACCESS_TOKEN/);
});
test('コードにトークンや実在のIDが書かれていない', () => {
  const fs = require('fs');
  for (const f of ['Code.gs', 'Dialog.html']) {
    const src = fs.readFileSync(__dirname + '/../src/' + f, 'utf8');
    assert.ok(!/Bearer\s+[A-Za-z0-9+/=]{20,}/.test(src)); assert.ok(!/U[0-9a-f]{32}/.test(src));
  }
});
