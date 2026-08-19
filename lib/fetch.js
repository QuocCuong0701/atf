// Zero-dependency fetch:
// - Node >= 18 có global fetch → dùng thẳng.
// - Node 16 trở xuống (không có global fetch) → fallback nhẹ bằng http/https có sẵn,
//   đủ API mà bot cần: ok/status/statusText/json()/text().

const http = require('http');
const https = require('https');
const zlib = require('zlib');

function fetchFallback(url, options = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(url);
    } catch (e) {
      reject(new TypeError(`Invalid URL: ${url}`));
      return;
    }
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(
      u,
      {
        method: options.method || 'GET',
        headers: options.headers || {},
      },
      (res) => {
        // follow redirect (tối đa 5 lần, giống fetch gốc)
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location &&
          options._redirects !== 5
        ) {
          res.resume();
          fetchFallback(new URL(res.headers.location, u).href, {
            ...options,
            _redirects: (options._redirects || 0) + 1,
          }).then(resolve, reject);
          return;
        }
        const chunks = [];
        const enc = String(res.headers['content-encoding'] || '').toLowerCase();
        const stream =
          enc === 'gzip' ? res.pipe(zlib.createGunzip()) : enc === 'deflate' ? res.pipe(zlib.createInflate()) : res;
        stream.on('data', (c) => chunks.push(c));
        // Đề phòng mất kết nối giữa chừng hoặc gzip lỗi — reject thay vì crash cả bot
        stream.on('error', (e) => {
          const err = new TypeError('fetch failed');
          err.cause = e;
          err.code = e.code;
          reject(err);
        });
        stream.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf-8');
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            statusText: res.statusMessage || '',
            json: async () => JSON.parse(text),
            text: async () => text,
          });
        });
      }
    );
    req.on('error', (e) => {
      // Node 16 chưa có AggregateError/cause của undici — wrap để message giống fetch gốc
      const err = new TypeError('fetch failed');
      err.cause = e;
      err.code = e.code;
      reject(err);
    });
    if (options.body) req.write(options.body);
    req.end();
  });
}

module.exports = typeof fetch === 'function' ? fetch : fetchFallback;
