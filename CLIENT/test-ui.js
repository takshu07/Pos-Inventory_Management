import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();
  
  page.on('console', msg => {
    console.log(`[Browser Console] ${msg.type()}: ${msg.text()}`);
  });

  page.on('pageerror', error => {
    console.log('[Browser Page Error]', error.message);
  });

  try {
    console.log("Navigating to login...");
    await page.goto('http://localhost:5174/login', { waitUntil: 'networkidle2' });
    
    console.log("Filling form...");
    await page.type('input[name="identifier"]', 'takshubudhlakoti123@gmail.com');
    await page.type('input[name="password"]', 'ColdBeast@123');
    
    console.log("Submitting...");
    await Promise.all([
      page.click('button[type="submit"]'),
      page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 5000 }).catch(() => console.log("Timeout waiting for navigation")),
    ]);
    
    const url = page.url();
    console.log("Current URL after login:", url);
    
    const bodyText = await page.$eval('body', el => el.innerText);
    console.log("Body text snippet:", bodyText.substring(0, 200).replace(/\n/g, ' '));
  } catch (e) {
    console.log("Test failed", e.message);
  }
  
  await browser.close();
})();
