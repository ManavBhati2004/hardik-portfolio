const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-gl=angle', '--use-angle=swiftshader']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 3000));

  // Move mouse to left fog bank to trigger repel
  await page.mouse.move(500, 800, { steps: 25 });
  await new Promise(r => setTimeout(r, 600));
  await page.screenshot({ path: 'C:/Users/Owner/.gemini/antigravity/brain/e17ac083-d184-439b-b20c-e9b658e2ac21/repel_left.png' });

  // Move mouse through center to right fog bank
  await page.mouse.move(1400, 750, { steps: 35 });
  await new Promise(r => setTimeout(r, 600));
  await page.screenshot({ path: 'C:/Users/Owner/.gemini/antigravity/brain/e17ac083-d184-439b-b20c-e9b658e2ac21/repel_right.png' });

  await browser.close();
  console.log('Repel test complete!');
})();

