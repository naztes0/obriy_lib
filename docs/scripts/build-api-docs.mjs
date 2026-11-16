import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import SwaggerParser from '@apidevtools/swagger-parser';
import specification from '../openapi/openapi.mjs';

const require = createRequire(import.meta.url);
const currentDirectory = dirname(fileURLToPath(import.meta.url));
const docsDirectory = resolve(currentDirectory, '..');
const generatedDirectory = resolve(docsDirectory, 'generated');
const apiDirectory = resolve(generatedDirectory, 'api');
const swaggerDirectory = require('swagger-ui-dist').getAbsoluteFSPath();

await SwaggerParser.validate(specification);
await rm(apiDirectory, { recursive: true, force: true });
await mkdir(apiDirectory, { recursive: true });

for (const file of ['swagger-ui.css', 'swagger-ui-bundle.js', 'swagger-ui-standalone-preset.js']) {
  await cp(resolve(swaggerDirectory, file), resolve(apiDirectory, file));
}

await writeFile(resolve(apiDirectory, 'openapi.json'), `${JSON.stringify(specification, null, 2)}\n`, 'utf8');
await writeFile(resolve(apiDirectory, 'index.html'), `<!doctype html>
<html lang="uk">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Обрій API · Swagger UI</title>
  <link rel="stylesheet" href="./swagger-ui.css">
  <style>body{margin:0;background:#f5f8f7}.topbar{display:none}.swagger-ui .info .title{color:#075e58}.swagger-ui .opblock-tag{font-family:system-ui,sans-serif}</style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="./swagger-ui-bundle.js"></script>
  <script src="./swagger-ui-standalone-preset.js"></script>
  <script>
    SwaggerUIBundle({
      url: './openapi.json',
      dom_id: '#swagger-ui',
      deepLinking: true,
      displayRequestDuration: true,
      filter: true,
      validatorUrl: null,
      supportedSubmitMethods: [],
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
      layout: 'BaseLayout'
    });
  </script>
</body>
</html>`, 'utf8');

await mkdir(generatedDirectory, { recursive: true });
await writeFile(resolve(generatedDirectory, 'index.html'), `<!doctype html>
<html lang="uk">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Технічна документація · Бібліотека Обрій</title>
  <style>
    :root{font-family:Inter,Segoe UI,Arial,sans-serif;color:#142626;background:#eff6f4}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:32px;background:radial-gradient(circle at top right,#bde8e0,transparent 38%),#eff6f4}.shell{width:min(960px,100%);background:white;border:1px solid #d7e5e2;border-radius:28px;overflow:hidden;box-shadow:0 25px 80px #163f3828}.hero{padding:58px;background:linear-gradient(125deg,#0b5f58,#0a9183);color:white}.eyebrow{font-size:12px;letter-spacing:.13em;text-transform:uppercase;color:#bcebe4}.hero h1{max-width:720px;margin:14px 0 12px;font-size:clamp(36px,6vw,64px);line-height:1.02}.hero p{margin:0;color:#d9f4ef;font-size:18px}.cards{display:grid;grid-template-columns:1fr 1fr;gap:18px;padding:32px}.card{display:block;padding:28px;border:1px solid #d6e4e1;border-radius:18px;color:inherit;text-decoration:none;transition:.2s}.card:hover{transform:translateY(-3px);border-color:#11998b;box-shadow:0 14px 35px #0a6d6220}.card small{color:#087f75;font-weight:700;text-transform:uppercase;letter-spacing:.08em}.card h2{margin:10px 0 8px}.card p{margin:0;color:#617575;line-height:1.55}.meta{padding:0 32px 30px;color:#718582;font-size:13px}@media(max-width:680px){.hero{padding:38px 28px}.cards{grid-template-columns:1fr;padding:22px}}
  </style>
</head>
<body>
  <main class="shell">
    <header class="hero"><div class="eyebrow">Автоматично згенерована документація</div><h1>Бібліотека «Обрій»</h1><p>Код backend та HTTP API в одному комплекті.</p></header>
    <section class="cards">
      <a class="card" href="./code/index.html"><small>JSDoc</small><h2>Документація коду</h2><p>Класи, методи, функції, параметри й вихідні файли backend.</p></a>
      <a class="card" href="./api/index.html"><small>OpenAPI 3.0</small><h2>Документація API</h2><p>Маршрути, ролі, параметри, JSON-схеми, відповіді та помилки.</p></a>
    </section>
    <div class="meta">Збірка: <code>pnpm docs:build</code> · джерела зберігаються разом із кодом</div>
  </main>
</body>
</html>`, 'utf8');

console.log(`OpenAPI documentation built in ${apiDirectory}`);

