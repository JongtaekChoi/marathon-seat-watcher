import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

function loadEnv() {
  const p = path.resolve('.env');
  const out = {};
  if (!fs.existsSync(p)) return out;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    if (!line || line.trim().startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 0) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

const env = { ...process.env, ...loadEnv() };
const RACE_URL = env.RACE_URL || 'https://race.cjsports.or.kr/03/intro.php';
const APPLICANT_NAME = env.APPLICANT_NAME || '';
const APPLICANT_PASSWORD = env.APPLICANT_PASSWORD || '';
const APPLICANT_SEX = (env.APPLICANT_SEX || 'M').toUpperCase();
const BIRTH_YYYYMMDD = env.BIRTH_YYYYMMDD || '';
const DEBUG = (env.DEBUG || 'true').toLowerCase() !== 'false';

function logStep(step, extra = '') {
  if (!DEBUG) return;
  const ts = new Date().toISOString();
  console.log(`[${ts}] [STEP] ${step}${extra ? ` | ${extra}` : ''}`);
}

if (!APPLICANT_NAME || !APPLICANT_PASSWORD || !APPLICANT_SEX || !BIRTH_YYYYMMDD || BIRTH_YYYYMMDD.length !== 8) {
  logStep('env_check_failed', 'APPLICANT_NAME/APPLICANT_PASSWORD/APPLICANT_SEX/BIRTH_YYYYMMDD missing');
  console.log(JSON.stringify({ ok: false, reason: 'missing_env', need: ['APPLICANT_NAME', 'APPLICANT_PASSWORD', 'APPLICANT_SEX', 'BIRTH_YYYYMMDD(YYYYMMDD)'] }));
  process.exit(2);
}

const SELECTORS = {
  agree: 'input[type="checkbox"]',
  name: '#agree_name, input[name="reg_name"]',
  password: '#agree_pw, input[name="pw"]',
  male: '#chk_men, input[name="sex"][value="M"]',
  female: '#chk_women, input[name="sex"][value="F"]',
  submit: 'button:has-text("신청"), input[type="submit"]',
  general: 'text=일반',
  full: '#Full'
};

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  let available = false;
  let detail = 'unknown';

  try {
    logStep('start', `url=${RACE_URL}`);
    await page.goto(RACE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    logStep('page_loaded', `title=${await page.title()}`);

    const agrees = page.locator(SELECTORS.agree);
    const agreeCount = await agrees.count();
    logStep('agree_checkboxes_found', String(agreeCount));
    for (let i = 0; i < agreeCount; i++) {
      const box = agrees.nth(i);
      if (!(await box.isChecked().catch(() => false))) {
        await box.check({ force: true }).catch(() => {});
      }
    }

    await page.locator(SELECTORS.name).first().fill(APPLICANT_NAME).catch(() => {});
    await page.locator(SELECTORS.password).first().fill(APPLICANT_PASSWORD).catch(() => {});

    const by = BIRTH_YYYYMMDD.slice(0, 4);
    const bm2 = BIRTH_YYYYMMDD.slice(4, 6);
    const bd2 = BIRTH_YYYYMMDD.slice(6, 8);

    const yearOptions = await page.locator('select[name="birth_year"] option').allTextContents().catch(() => []);
    const monthOptions = await page.locator('select[name="birth_month"] option').evaluateAll(opts => opts.map(o => (o.value || '').trim())).catch(() => []);
    const dayOptions = await page.locator('select[name="birth_day"] option').evaluateAll(opts => opts.map(o => (o.value || '').trim())).catch(() => []);
    logStep('birth_options_probe', `year_opts=${yearOptions.length}, month_vals=${monthOptions.slice(0,5).join(',')}, day_vals=${dayOptions.slice(0,5).join(',')}`);

    await page.selectOption('select[name="birth_year"]', { value: by }).catch(() => {});
    const monthVal = monthOptions.includes(bm2) ? bm2 : String(parseInt(bm2, 10));
    const dayVal = dayOptions.includes(bd2) ? bd2 : String(parseInt(bd2, 10));
    await page.selectOption('select[name="birth_month"]', { value: monthVal }).catch(() => {});
    await page.selectOption('select[name="birth_day"]', { value: dayVal }).catch(() => {});

    if (APPLICANT_SEX === 'F') {
      await page.locator(SELECTORS.female).first().check({ force: true }).catch(() => {});
    } else {
      await page.locator(SELECTORS.male).first().check({ force: true }).catch(() => {});
    }
    logStep('form_filled', `name=${APPLICANT_NAME}, sex=${APPLICANT_SEX}, birth=${by}-${monthVal}-${dayVal}`);

    await page.locator(SELECTORS.submit).first().click({ timeout: 5000 }).catch(() => {});
    logStep('submit_clicked');
    await page.waitForTimeout(1200);

    const pages = page.context().pages();
    logStep('context_pages_after_submit', pages.map(p => p.url()).join(' | '));

    const candidatePages = Array.from(new Set([page, ...pages]));

    let workPage = page;
    let foundGeneral = false;

    for (const p of candidatePages) {
      const frameList = p.frames();
      logStep('scan_page', `url=${p.url()} frames=${frameList.length}`);
      for (const f of frameList) {
        const gCount = await f.locator(SELECTORS.general).count().catch(() => 0);
        const rCount = await f.locator('input[type="radio"]').count().catch(() => 0);
        logStep('scan_frame', `url=${f.url()} general=${gCount} radios=${rCount}`);
        if (gCount > 0 && !foundGeneral) {
          await f.locator(SELECTORS.general).first().click({ timeout: 5000 }).catch(() => {});
          logStep('general_clicked', `frame=${f.url()}`);
          foundGeneral = true;
          workPage = p;
          await p.waitForTimeout(800);
          break;
        }
      }
      if (foundGeneral) break;
    }

    if (!foundGeneral) {
      await page.locator(SELECTORS.general).first().click({ timeout: 5000 }).catch(() => {});
      logStep('general_clicked', 'fallback_main_page');
      await page.waitForTimeout(800);
    }

    const dumpInputs = await workPage.evaluate(() => {
      return Array.from(document.querySelectorAll('input')).map(i => ({
        id: i.id,
        name: i.name,
        type: i.type,
        value: i.value,
        checked: i.checked,
        onclick: i.getAttribute('onclick')
      })).slice(0, 300);
    }).catch(() => []);
    logStep('input_dump_count', String(dumpInputs.length));

    let fullCount = 0;
    for (const p of candidatePages) {
      const frameList = p.frames();
      for (const f of frameList) {
        const c = await f.locator(SELECTORS.full).count().catch(() => 0);
        if (c > 0) {
          fullCount = c;
          await f.locator(SELECTORS.full).first().click({ force: true }).catch(() => {});
          logStep('full_radio_clicked', `frame=${f.url()}`);
          workPage = p;
          break;
        }
      }
      if (fullCount > 0) break;
    }
    logStep('full_radio_found', String(fullCount));

    logStep('checkFree_probe_start');
    const result = await workPage.evaluate(() => {
      try {
        if (typeof window.checkFree === 'function') {
          const t = window.checkFree(true);
          const f = window.checkFree(false);
          return { hasCheckFree: true, trueCall: t, falseCall: f };
        }
      } catch (e) {
        return { hasCheckFree: true, error: String(e) };
      }
      return { hasCheckFree: false };
    });

    if (result?.hasCheckFree && result?.trueCall === true) {
      available = true;
      detail = 'checkFree_true';
    } else {
      available = false;
      detail = JSON.stringify(result);
    }

    logStep('result_decided', `available=${available}, detail=${detail}`);
    console.log(JSON.stringify({ ok: true, available, detail }));
  } catch (e) {
    console.log(JSON.stringify({ ok: false, error: String(e) }));
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
