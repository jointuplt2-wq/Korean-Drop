// Korean Drop — Icon & OG Image Generator
// Run: npm run gen-icons
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs   = require('fs');

const ROOT  = path.join(__dirname, '..');
const BUILD = path.join(ROOT, 'build');

// 단일 256px PNG → .ico 변환 (외부 도구 불필요)
function pngToIco(pngBuf) {
  const dataOffset = 6 + 16;
  const hdr = Buffer.alloc(6);
  hdr.writeUInt16LE(0, 0);   // Reserved
  hdr.writeUInt16LE(1, 2);   // Type: ICO
  hdr.writeUInt16LE(1, 4);   // Image count: 1
  const dir = Buffer.alloc(16);
  dir.writeUInt8(0, 0);      // Width  0 = 256
  dir.writeUInt8(0, 1);      // Height 0 = 256
  dir.writeUInt8(0, 2);      // Colors
  dir.writeUInt8(0, 3);      // Reserved
  dir.writeUInt16LE(1,  4);  // Planes
  dir.writeUInt16LE(32, 6);  // Bit depth
  dir.writeUInt32LE(pngBuf.length, 8);   // Data size
  dir.writeUInt32LE(dataOffset,   12);   // Data offset
  return Buffer.concat([hdr, dir, pngBuf]);
}

async function capture(htmlFile, w, h) {
  const win = new BrowserWindow({
    width: w, height: h,
    show: false, frame: false,
    backgroundColor: '#00000000',
    transparent: true,
    webPreferences: { contextIsolation: true },
  });
  await win.loadFile(path.join(ROOT, 'assets', htmlFile));
  await new Promise(r => setTimeout(r, 600)); // 폰트 렌더링 대기
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: w, height: h });
  win.close();
  return img.toPNG();
}

app.whenReady().then(async () => {
  fs.mkdirSync(BUILD, { recursive: true });
  console.log('\n🎨 Korean Drop 아이콘 생성 시작...\n');

  // ── 앱 아이콘 (PNG 다중 사이즈) ──
  const SIZES = [16, 32, 48, 64, 128, 256, 512];
  for (const size of SIZES) {
    const buf = await capture('icon.html', size, size);
    fs.writeFileSync(path.join(BUILD, `icon-${size}.png`), buf);
    console.log(`  ✓ icon-${size}.png`);
  }

  // 기본 icon.png (256px)
  fs.copyFileSync(
    path.join(BUILD, 'icon-256.png'),
    path.join(BUILD, 'icon.png')
  );
  console.log('  ✓ icon.png (256px 복사)');

  // Windows .ico (256px PNG 임베드)
  const ico = pngToIco(fs.readFileSync(path.join(BUILD, 'icon-256.png')));
  fs.writeFileSync(path.join(BUILD, 'icon.ico'), ico);
  console.log('  ✓ icon.ico');

  // ── OG 이미지 (1200×630) ──
  const ogBuf = await capture('og.html', 1200, 630);
  fs.writeFileSync(path.join(BUILD, 'og-image.png'), ogBuf);
  console.log('  ✓ og-image.png (1200×630)');

  console.log('\n✅ 완료! build/ 폴더를 확인하세요.\n');
  console.log('  macOS .icns 생성 시:');
  console.log('  iconutil -c icns build/icon.iconset  (Mac에서 실행)\n');
  app.quit();
});

app.on('window-all-closed', () => {});
