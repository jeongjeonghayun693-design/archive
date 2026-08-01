/**
 * 로컬 테스트용 초경량 정적 서버 (설치 필요 없음, Node 내장 모듈만 사용).
 *   node serve.js         → http://localhost:8080
 *   node serve.js 3000    → 포트 바꾸기
 *
 * file:// 로 열면 ES 모듈과 Google 로그인이 막히므로 반드시 http 로 열어야 한다.
 */
const http = require("http");
const fs = require("fs");
const path = require("path");

const root = __dirname;
const port = Number(process.argv[2]) || 8080;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".md": "text/markdown; charset=utf-8",
};

http
  .createServer((req, res) => {
    const url = decodeURIComponent(req.url.split("?")[0]);
    let filePath = path.join(root, url === "/" ? "index.html" : url);

    // 루트 밖으로 나가는 경로 차단
    if (!filePath.startsWith(root)) {
      res.writeHead(403).end("403");
      return;
    }

    fs.stat(filePath, (err, stat) => {
      if (err || stat.isDirectory()) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("404 Not Found");
        return;
      }
      res.writeHead(200, {
        "Content-Type": TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream",
        "Cache-Control": "no-store",
      });
      fs.createReadStream(filePath).pipe(res);
    });
  })
  .listen(port, () => {
    console.log(`ARCHIVE 로컬 서버: http://localhost:${port}`);
  });
