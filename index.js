// index.js
require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const yf = require('yahoo-finance2').default;
const moji = require('moji');
const fs = require('fs');
const path = require('path');
yf.suppressNotices(['yahooSurvey']);

const tickerList = JSON.parse(fs.readFileSync(path.join(__dirname, 'japan_tickers.json'), 'utf8'));

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};

const app = express();
app.use(express.json());
app.post('/webhook', line.middleware(config), (req, res) => {
  Promise.all(req.body.events.map(handleEvent)).then((result) => res.json(result));
});

const client = new line.Client(config);

function normalize(text) {
  return moji(text)
    .convert('ZE', 'HE')
    .convert('ZS', 'HS')
    .toString()
    .toLowerCase()
    .replace(/\s/g, '')
    .normalize('NFKC');
}

function getTickerFromName(nameInput) {
  const normInput = normalize(nameInput);
  const exact = tickerList.find(entry => normalize(entry.name) === normInput);
  if (exact) return exact.code + '.T';
  const partial = tickerList.find(entry => normalize(entry.name).includes(normInput));
  return partial ? partial.code + '.T' : null;
}

async function convertToTicker(text) {
  if (!text || typeof text !== 'string' || text.trim() === '') return null;
  const input = normalize(text.trim());
  if (/^\d{4}$/.test(input)) return `${input}.T`;
  const ticker = getTickerFromName(input);
  if (ticker) return ticker;
  try {
    const results = await yf.search(input);
    const jpStock = results.quotes.find(q => q.exchange === 'TYO' && q.symbol.endsWith('.T'));
    return jpStock?.symbol || null;
  } catch (e) {
    console.error('検索エラー', e);
    return null;
  }
}

async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') return null;
  const input = event.message.text.trim();
  if (!input || input.replace(/\s/g, '').length === 0) {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '銘柄名またはコードを入力してください（例：7974 または 任天堂）',
    });
  }

  const symbol = await convertToTicker(input);
  const jpName = tickerList.find(e => `${e.code}.T` === symbol)?.name || symbol;

  if (!symbol) {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '銘柄名またはコードが認識できません（例：7974 または 任天堂）',
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
PER：${perValue}倍　PBR：${stats.priceToBook ? stats.priceToBook.toFixed(2) : '-'}倍
EPS：${eps || '-'}　配当金：${detail.dividendRate || '-'}円
利回り：${detail.dividendYield ? (detail.dividendYield * 100).toFixed(2) : '-'}%
ROE：${fin.returnOnEquity ? (fin.returnOnEquity * 100).toFixed(2) : '-'}%
BPS：${stats.bookValue ? Math.round(stats.bookValue) : '-'}　時価総額：${marketCapText}`;

    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: reply,
    });
  } catch (error) {
    console.error(error);
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: 'データ取得に失敗しました。証券コードを確認してください。',
    });
  }
}

// 値上がりランキング通知エンドポイント
app.get('/ranking-push', async (req, res) => {
  try {
    const results = await yf.gainers('JP');
    const symbols = results
      .filter(s => s.symbol.endsWith('.T'))
      .slice(0, 5)
      .map(s => s.symbol);

    const messages = await Promise.all(symbols.map(async symbol => {
      const quote = await yf.quoteSummary(symbol, { modules: ['price'] });
      const price = quote.price || {};
      const name = price.shortName || symbol;
      const change = price.regularMarketChangePercent?.toFixed(2) || '-';
      return `📈 ${name}：${price.regularMarketPrice}円（+${change}%）`;
    }));

    await client.broadcast({ type: 'text', text: `📊 本日の値上がり銘柄ランキング\n${messages.join('\n')}` });
    res.status(200).send('OK');
  } catch (err) {
    console.error('ランキング取得エラー', err);
    res.status(500).send('エラー発生');
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`株太郎Bot（完全版）起動中 on port ${port}`);
});
