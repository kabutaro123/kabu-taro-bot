require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');

// LINE Botの設定
const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};

const app = express();
const client = new line.Client(config);

// RapidAPIの設定
const options = {
  method: 'GET',
  url: 'https://yh-finance.p.rapidapi.com/market/get-movers',
  params: { region: 'JP' },
  headers: {
    'X-RapidAPI-Key': process.env.RAPIDAPI_KEY,
    'X-RapidAPI-Host': 'yh-finance.p.rapidapi.com'
  }
};

// トップランキングの取得関数
async function fetchMovers(type = 'gainers') {
  try {
    const res = await axios.request(options);
    const list = res.data.finance.result[0][type].slice(0, 5);
    const message = list.map((s, i) =>
      `${i + 1}位：${s.symbol}（${s.shortName || '銘柄名なし'}） ${s.regularMarketChangePercent.toFixed(2)}%`
    ).join('\n');

    return `📈 本日の${type === 'gainers' ? '上昇' : type === 'losers' ? '下落' : '出来高'}ランキングTOP5\n\n${message}`;
  } catch (err) {
    console.error('ランキング取得失敗:', err);
    return 'ランキング取得に失敗しました。';
  }
}

// 毎日9時にPush通知（UTC0時 = 日本時間9時）
cron.schedule('0 0 * * *', async () => {
  const rankingMessage = await fetchMovers('gainers');
  const userId = 'U9e59306b1a3fcc66cd0b181286763e23'; // あなたのLINEユーザーIDをここに
  client.pushMessage(userId, {
    type: 'text',
    text: rankingMessage,
  });
});

// Webhook設定
app.post('/webhook', line.middleware(config), async (req, res) => {
  try {
    const results = await Promise.all(req.body.events.map(handleEvent));
    res.json(results);
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).end();
  }
});

async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') return null;
  const input = event.message.text.trim();
  
  if (!input || input.replace(/\s/g, '').length === 0) {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '銘柄名またはコードを入力してください（例：7974 または 任天堂）',
    });
  }
  
  // その他の処理（銘柄名検索など）をここで行う
  
  return client.replyMessage(event.replyToken, {
    type: 'text',
    text: '銘柄情報が取得できました。',
  });
}

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`株太郎Bot 起動中 on port ${port}`);
});
