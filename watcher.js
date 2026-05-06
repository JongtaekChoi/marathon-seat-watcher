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
const RACE_URL = env.RACE_URL || 'https://race.cjsports.or.kr/03/';
const APPLICANT_NAME = env.APPLICANT_NAME || '';
const BIRTH_YYYYMMDD = env.BIRTH_YYYYMMDD || '';
const DEBUG = (env.DEBUG || 'true').toLowerCase() !== 'false';

function logStep(step, extra = '') {
  if (!DEBUG) return;
  const ts = new Date().toISOString();
  console.log(`[${ts}] [STEP] ${step}${extra ? ` | ${extra}` : ''}`);
}

if (!APPLICANT_NAME || !BIRTH_YYYYMMDD) {
  logStep('env_check_failed', 'APPLICANT_NAME/BIRTH_YYYYMMDD missing');
  console.log(JSON.stringify({ ok: false, reason: 'missing_env', need: ['APPLICANT_NAME', 'BIRTH_YYYYMMDD'] }));
  process.exit(2);
}

const SELECTORS = {
  agree: 'input[type="checkbox"]',
  name: 'input[name*="name" i], input[id*="name" i]',
  birth: 'input[name*="birth" i], input[id*="birth" i]',
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
    await page.locator(SELECTORS.birth).first().fill(BIRTH_YYYYMMDD).catch(() => {});
    logStep('form_filled', `name=${APPLICANT_NAME}, birth=${BIRTH_YYYYMMDD}`);

    await page.locator(SELECTORS.submit).first().click({ timeout: 5000 }).catch(() => {});
    logStep('submit_clicked');
    await page.waitForTimeout(1000);

    await page.locator(SELECTORS.general).first().click({ timeout: 5000 }).catch(() => {});
    logStep('general_clicked');
    await page.waitForTimeout(500);

    const full = page.locator(SELECTORS.full);
    const fullCount = await full.count();
    logStep('full_radio_found', String(fullCount));
    if (fullCount) {
      await full.first().click({ force: true }).catch(() => {});
      logStep('full_radio_clicked');
    }

    logStep('checkFree_probe_start');
    const result = await page.evaluate(() => {
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
