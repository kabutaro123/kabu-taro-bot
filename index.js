require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const yf = require('yahoo-finance2').default;
const moji = require('moji');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch'); // ← ランキング通知で使用
const cron = require('node-cron');

// Yahooの通知抑制
yf.suppressNotices(['yahooSurvey']);

// 銘柄一覧読み込み（事前に用意されたjson）
const tickerList = JSON.parse(fs.readFileSync(path.join(__dirname, 'japan_tickers.json'), 'utf8'));

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};

const app = express();

app.post('/webhook', line.middleware(config), async (req, res) => {
  try {
    const results = await Promise.all(req.body.events.map(handleEvent));
    res.json(results);
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).end();
  }
});

const client = new line.Client(config);

// 正規化（全角→半角・小文字化など）
function normalize(text) {
  return moji(text).convert('ZE', 'HE').convert('ZS', 'HS').toString().toLowerCase().replace(/\s/g, '').normalize('NFKC');
}

// 銘柄名から証券コードを探す
function getTickerFromName(nameInput) {
  const normInput = normalize(nameInput);
  const exact = tickerList.find(entry => normalize(entry.name) === normInput);
  if (exact) return exact.code + '.T';
  const partial = tickerList.find(entry => normalize(entry.name).includes(normInput));
  return partial ? partial.code + '.T' : null;
}

// 入力から証券コードを推定
async function convertToTicker(text) {
  if (!text || typeof text !== 'string') return null;
  const input = normalize(text.trim());
  if (/^\d{4}$/.test(input)) return `${input}.T`;
  const ticker = getTickerFromName(input);
  if (ticker) return ticker;
  try {
    const results = await yf.search(input);
    const jpStock = results.quotes.find(q => q.exchange === 'TYO' && q.symbol.endsWith('.T'));
    return jpStock?.symbol || null;
  } catch (e) {
    console.error('検索エラー:', e);
    return null;
  }
}

// LINEメッセージ応答
async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') return null;

  const input = event.message.text.trim();
  const symbol = await convertToTicker(input);
  const jpName = tickerList.find(e => `${e.code}.T` === symbol)?.name || symbol;

  if (!symbol) {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '銘柄名または証券コードを入力してください（例：7974 または 任天堂）',
    });
  }

  try {
    const quote = await yf.quoteSummary(symbol, {
      modules: ['price', 'summaryDetail', 'defaultKeyStatistics', 'financialData']
    });

    const price = quote.price || {};
    const detail = quote.summaryDetail || {};
    const stats = quote.defaultKeyStatistics || {};
    const fin = quote.financialData || {};

    let marketCapText = '-';
    if (price.marketCap) {
      marketCapText = price.marketCap >= 1e12
        ? (price.marketCap / 1e12).toFixed(2) + '兆円'
        : Math.round(price.marketCap / 1e8) + '億円';
    }

    let perValue = '-';
    const trailing = stats?.trailingPE;
    const forward = fin?.forwardPE;
    const eps = stats?.trailingEps;
    const stockPrice = price?.regularMarketPrice;

    if (typeof trailing === 'number' && trailing > 0) {
      perValue = trailing.toFixed(2);
    } else if (typeof forward === 'number' && forward > 0) {
      perValue = forward.toFixed(2);
    } else if (typeof stockPrice === 'number' && typeof eps === 'number' && eps > 0) {
      perValue = (stockPrice / eps).toFixed(2);
    }

    const reply =
`📈 ${jpName}
株価：${price.regularMarketPrice}円
PER：${perValue}倍　PBR：${stats.priceToBook?.toFixed(2) || '-'}倍
EPS：${eps || '-'}　配当金：${detail.dividendRate || '-'}円
利回り：${detail.dividendYield ? (detail.dividendYield * 100).toFixed(2) : '-'}%
ROE：${fin.returnOnEquity ? (fin.returnOnEquity * 100).toFixed(2) : '-'}%
BPS：${stats.bookValue ? Math.round(stats.bookValue) : '-'}　時価総額：${marketCapText}`;

    return client.replyMessage(event.replyToken, { type: 'text', text: reply });
  } catch (err) {
    console.error('データ取得失敗:', err);
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '銘柄情報の取得に失敗しました。',
    });
  }
}

// 🎯 Finnhub ランキング取得
async function fetchTopGainers() {
  try {
    const url = `https://finnhub.io/api/v1/stock/symbol?exchange=TSE&token=${process.env.FINNHUB_API_KEY}`;
    const res = await fetch(url);
    const data = await res.json();

    // 仮のテスト用（本来は上昇率データを持つAPIを使うべき）
    const top5 = data.slice(0, 5);
    const message = top5.map((item, i) =>
      `${i + 1}位：${item.description || item.symbol}（テスト）`
    ).join('\n');

    return `📊 テスト上昇率ランキング（仮）\n\n${message}`;
  } catch (err) {
    console.error('ランキング取得失敗:', err);
    return 'ランキング取得に失敗しました。';
  }
}

// 🕘 毎日9時にPush通知
cron.schedule('0 0 * * *', async () => {
  const rankingMessage = await fetchTopGainers();
  const userId = process.env.MY_LINE_USER_ID;
  await client.pushMessage(userId, { type: 'text', text: rankingMessage });
});

// 🧪 手動Push通知（起動時）
(async () => {
  const rankingMessage = await fetchTopGainers();
  const userId = process.env.MY_LINE_USER_ID;
  await client.pushMessage(userId, {
    type: 'text',
    text: `[テスト通知]\n${rankingMessage}`,
  }).then(() => {
    console.log('Push通知送信完了！');
  }).catch((err) => {
    console.error('Push通知失敗:', err);
  });
})();

// 起動
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`✅ 株太郎Bot 起動中 on port ${port}`);
});
