const axios = require('axios');
const XLSX = require('xlsx');
const iconv = require('iconv-lite');
const fs = require('fs');
const path = require('path');

// JPX上場銘柄一覧（Excel）のURL（2024年時点）
const url = 'https://www.jpx.co.jp/markets/statistics-equities/misc/tvdivq0000001vg2-att/data_j.xls';

async function downloadAndConvert() {
  try {
    // バイナリでダウンロード（Shift-JISエンコード）
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    const buffer = iconv.decode(Buffer.from(response.data), 'binary');

    // Excelとして読み込み（1つ目のシート想定）
    const workbook = XLSX.read(buffer, { type: 'binary' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(sheet);

    // 必要なカラム（コード・銘柄名）だけ抽出し整形
    const result = data.map(row => ({
      code: String(row['コード']).padStart(4, '0'),
      name: row['銘柄名']
    })).filter(row => row.code && row.name);

    // JSON出力
    const outputPath = path.join(__dirname, 'japan_tickers.json');
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf-8');
    console.log(`✅ ${result.length}銘柄を保存しました：${outputPath}`);
  } catch (error) {
    console.error('❌ 銘柄リスト更新失敗:', error);
  }
}

downloadAndConvert();
