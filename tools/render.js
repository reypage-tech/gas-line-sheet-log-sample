// ローカル模擬で流した結果から、シート画面の画像とPDFを作る（実際のGoogle・LINEは使わない）
const fs = require('fs'); const path = require('path'); const { execFileSync } = require('child_process');
const { load } = require('../test/mock'); const ev = require('../sample_data/webhook_events.json');
const env = load({ profiles: { Udemo0001: '架空顧客A', Udemo0002: '架空顧客B' } });
const realNow = Date.now; let clock = Date.UTC(2026, 9, 28, 1, 5, 0);
env.ctx.Date.now = () => clock;
env.ctx.doPost({ postData: { contents: JSON.stringify(ev) } });
env.ctx.sendByName('架空顧客A', 'ご連絡ありがとうございます。担当よりお見積書をお送りします', '');
clock += 10 * 60000;
env.ctx.sendByName('架空顧客A', 'お見積書です。ご確認ください', 'https://example.com/demo/estimate.jpg');
clock += 50 * 60000;
env.ctx.sendByName('架空顧客B', 'スタンプありがとうございます', '');
Date.now = realNow;
fs.writeFileSync(path.join(__dirname, '../sample_data/sheet_result.json'), JSON.stringify(env.rows, null, 1));
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const [head, ...body] = env.rows;
const table = `<table><tr><th></th>${head.map((h, i) => `<th>${String.fromCharCode(65 + i)}</th>`).join('')}</tr>
<tr><td class=n>1</td>${head.map(h => `<td class=h>${esc(h)}</td>`).join('')}</tr>
${body.map((r, i) => `<tr class="${String(r[4]).startsWith('送信') ? 'out' : 'in'}"><td class=n>${i + 2}</td>${r.map((c, j) => `<td${j === 3 && /^https/.test(c) ? ' class=l' : ''}>${esc(c)}</td>`).join('')}</tr>`).join('')}</table>`;
const css = `body{font-family:'Noto Sans CJK JP',sans-serif;margin:24px;color:#222}h1{font-size:20px}h2{font-size:16px;margin-top:28px}.note{font-size:12px;color:#555}
table{border-collapse:collapse;font-size:12px}td,th{border:1px solid #ccc;padding:4px 8px;white-space:nowrap}th{background:#f1f3f4;color:#555}.n{background:#f1f3f4;color:#555;text-align:center}.h{font-weight:bold;background:#e8f0fe}.out td:not(.n){background:#fff8e1}.l{color:#1a0dab;text-decoration:underline}
pre{background:#f6f8fa;border:1px solid #ddd;padding:12px;font-size:12.5px;line-height:1.45;white-space:pre-wrap}.tab{display:inline-block;border:1px solid #ccc;border-bottom:none;padding:3px 12px;background:#fff;font-size:12px}`;
const sheetHtml = `<html><head><meta charset=utf-8><style>${css}</style></head><body><h1>見本: LINEトーク履歴の自動転記（架空データ）</h1>
<p class=note>A〜D列は既存シートの並びのまま、E列から右が足した列です。白い行は受信、黄色の行は担当者がメニューの送信画面から送った分です。データはすべて架空で、ローカルの模擬環境で確認した結果を表の形にしています。実際のGoogle・LINEでは確認していません。</p>
<div class=tab>トーク履歴</div>${table}</body></html>`;
const code = fs.readFileSync(path.join(__dirname, '../src/Code.gs'), 'utf8');
const pick = (start, end) => { const a = code.indexOf(start); return code.slice(a, code.indexOf(end, a) + end.length); };
const codeHtml = `<html><head><meta charset=utf-8><style>${css}</style></head><body><h1>コードの要点（見本）</h1>
<h2>1. 表示名で選んで送り、同時に記録</h2><pre>${esc(pick('function findUserId_', '\n}'))}\n\n${esc(pick('function sendByName', '\n}'))}\n\n${esc(pick('function buildMessages_', '\n}'))}</pre>
<h2>2. 受信画像はドライブに保存してリンクを記録</h2><pre>${esc(pick('function saveImage_', '\n}'))}</pre>
<h2>3. 既存の4列は変えず、足す列は右に</h2><pre>${esc(pick('function getSheet_', '\n}'))}</pre></body></html>`;
const out = path.join(__dirname, '../docs'); fs.writeFileSync(out + '/sheet.html', sheetHtml); fs.writeFileSync(out + '/code.html', codeHtml);
const chrome = (args) => execFileSync('google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', ...args], { stdio: 'ignore' });
chrome(['--window-size=1250,400', '--screenshot=' + out + '/01_sheet.png', 'file://' + out + '/sheet.html']);
chrome(['--window-size=860,1250', '--screenshot=' + out + '/02_code.png', 'file://' + out + '/code.html']);
const dlg = fs.readFileSync(path.join(__dirname, '../src/Dialog.html'), 'utf8').replace(/<script>[\s\S]*<\/script>/, '')
  .replace('<select id="name"></select>', '<select id="name"><option>架空顧客A</option><option>架空顧客B</option></select>')
  .replace('<textarea id="text"></textarea>', '<textarea id="text">お見積書です。ご確認ください</textarea>')
  .replace('<input id="image">', '<input id="image" value="https://example.com/demo/estimate.jpg">')
  .replace('<div id="msg"></div>', '<div id="msg">送信済み（トーク履歴に記録しました）</div>')
  .replace('<body>', '<body style="margin:0;background:#888;font-family:\'Noto Sans CJK JP\',sans-serif"><style>select,textarea,input,button{font-family:inherit}</style><div style="background:#fff;margin:20px;padding:16px 20px;border-radius:6px;width:400px"><div style="font-size:16px;margin-bottom:6px">LINEで送る</div>').replace('</body>', '</div></body>');
fs.writeFileSync(out + '/dialog.html', dlg);
chrome(['--window-size=480,420', '--screenshot=' + out + '/03_dialog.png', 'file://' + out + '/dialog.html']);
console.log('ok', env.rows.length - 1, 'rows');
const memo = fs.readFileSync(path.join(__dirname, '../docs/MEMO_送信分の取り方.md'), 'utf8');
const guide = fs.readFileSync(path.join(__dirname, '../使い方.md'), 'utf8');
const md = s => esc(s).replace(/^# (.*)$/gm, '<h1>$1</h1>').replace(/^## (.*)$/gm, '<h2>$1</h2>').replace(/^(- |\d\. )(.*)$/gm, '<div>・$2</div>').replace(/\n\n/g, '<br>');
const pdfHtml = `<html><head><meta charset=utf-8><style>${css}img{width:100%;border:1px solid #ddd}.pb{page-break-before:always}</style></head><body>
<img src="01_sheet.png"><div style="font-size:12px;line-height:1.55">${md(memo)}</div>
<div class=pb></div><div style="font-size:13px;line-height:1.7">${md(guide)}</div><img src="03_dialog.png" style="width:55%">
<div class=pb></div><img src="02_code.png" style="width:78%">
<p class=note>データはすべて架空です。ローカルの模擬環境でテスト22件を通しています。実際のGoogle・LINEでは確認していません。</p></body></html>`;
fs.writeFileSync(out + '/pdf.html', pdfHtml);
chrome(['--no-pdf-header-footer', '--print-to-pdf=' + out + '/sample.pdf', 'file://' + out + '/pdf.html']);
