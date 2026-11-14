// สร้างเว็บโหมดทดลองสำหรับ GitHub Pages ไว้ที่ demo/dist (ไม่ต้องติดตั้งแพ็กเกจเพิ่ม)
//
//   node demo/build.mjs
//
// 1) คัดลอกหน้าเว็บจาก public/
// 2) รวมโค้ดคำนวณของเซิร์ฟเวอร์ (server/src) ที่ไม่ใช้ฐานข้อมูล เป็น js/demo-lib.js
//    เพื่อให้โหมดทดลองคำนวณสาย/OT, วันลาคงเหลือ, รายงาน และการนำเข้าไฟล์ ด้วยโค้ดชุดเดียวกับของจริง
// 3) ใส่ demo-server.js (จำลอง /api) และแถบโหมดทดลองลงในทุกหน้า
import {
    cp, mkdir, readFile, readdir, rm, writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'demo', 'dist');

// โมดูลของเซิร์ฟเวอร์ที่เป็นการคำนวณล้วน (require กันเองได้ ห้าม require แพ็กเกจภายนอก)
const SERVER_MODULES = ['validate', 'dates', 'worktime', 'settings', 'balances', 'monthlyReport', 'importRows'];
// โมดูลที่โหมดทดลองแทนที่ให้ (ฐานข้อมูลและ config ไม่มีในเบราว์เซอร์)
const SHIMS = {
    config: "module.exports = { timezone: 'Asia/Bangkok' };",
    db: 'module.exports = { pool: null };',
};

const bundleServerModules = async () => {
    const definitions = [];
    for (const [name, source] of Object.entries(SHIMS)) {
        definitions.push(`defs[${JSON.stringify(name)}] = function (module) { ${source} };`);
    }
    for (const name of SERVER_MODULES) {
        const source = await readFile(path.join(root, 'server', 'src', `${name}.js`), 'utf8');
        for (const [, dep] of source.matchAll(/require\('([^']+)'\)/g)) {
            const key = dep.replace(/^\.\//, '');
            if (!dep.startsWith('./') || !(SERVER_MODULES.includes(key) || key in SHIMS)) {
                throw new Error(`server/src/${name}.js ใช้ require('${dep}') ซึ่งใช้ในเบราว์เซอร์ไม่ได้`);
            }
        }
        definitions.push(`defs[${JSON.stringify(name)}] = function (module, exports, require) {\n${source}\n};`);
    }
    const exportsList = SERVER_MODULES.map((name) => `${name}: load(${JSON.stringify(name)})`).join(', ');
    return `// สร้างอัตโนมัติจาก server/src โดย demo/build.mjs (อย่าแก้ไฟล์นี้โดยตรง)
(() => {
const defs = {};
${definitions.join('\n')}
const cache = {};
const load = (request) => {
  const key = request.replace(/^\\.\\//, '');
  if (!cache[key]) {
    const module = { exports: {} };
    cache[key] = module;
    defs[key](module, module.exports, load);
  }
  return cache[key].exports;
};
window.TALSLib = { ${exportsList} };
})();
`;
};

const injectDemo = (html) => {
    if (!html.includes('<script src="js/common.js"></script>')) return html;
    return html
        .replace('<link rel="stylesheet" href="css/app.css">', '<link rel="stylesheet" href="css/app.css">\n    <link rel="stylesheet" href="css/demo.css">')
        .replace('<script src="js/common.js"></script>', '<script src="js/demo-lib.js"></script>\n    <script src="js/demo-server.js"></script>\n    <script src="js/common.js"></script>')
        .replace('</body>', '    <script src="js/demo-ui.js"></script>\n</body>');
};

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(path.join(root, 'public'), out, { recursive: true });

await writeFile(path.join(out, 'js', 'demo-lib.js'), await bundleServerModules());
await cp(path.join(root, 'demo', 'demo-server.js'), path.join(out, 'js', 'demo-server.js'));
await cp(path.join(root, 'demo', 'demo-ui.js'), path.join(out, 'js', 'demo-ui.js'));
await cp(path.join(root, 'demo', 'demo.css'), path.join(out, 'css', 'demo.css'));

let pages = 0;
for (const file of await readdir(out)) {
    if (!file.endsWith('.html')) continue;
    const target = path.join(out, file);
    const html = await readFile(target, 'utf8');
    const injected = injectDemo(html);
    if (injected !== html) pages += 1;
    await writeFile(target, injected);
}
// ให้ GitHub Pages ส่งไฟล์ตามที่เป็น (ไม่ผ่าน Jekyll)
await writeFile(path.join(out, '.nojekyll'), '');

console.log(`สร้างโหมดทดลองแล้วที่ ${path.relative(root, out)} (${pages} หน้า)`);
