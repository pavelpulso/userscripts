// ==UserScript==
// @name         Gemini Skill «Суть»: видео и статьи
// @namespace    pavel.youtube-gemini-summary
// @version      1.2.0
// @description  «Суть видео» on the YouTube watch page and on every video card in feeds, search and sidebar, «Суть статьи» on any article: opens Gemini, selects the matching Skill and sends the request.
// @match        *://*/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_openInTab
// @grant        GM_registerMenuCommand
// @updateURL    https://raw.githubusercontent.com/pavelpulso/userscripts/main/gemini-skill-summary.user.js
// @downloadURL  https://raw.githubusercontent.com/pavelpulso/userscripts/main/gemini-skill-summary.user.js
// @run-at       document-idle
// @noframes
// ==/UserScript==

const VIDEO_SKILL = 'youtube-summary';
const ARTICLE_SKILL = 'text-summary';
const WATCH_URL = 'https://www.youtube.com/watch?v=';
const AUTO_SEND = true;
const DEBUG = false;

const KEY = 'ytGeminiPending';
const MAX_AGE_MS = 120000;
const MAX_ARTICLE_CHARS = 30000;
const MIN_ARTICLE_CHARS = 2500;
const ARTICLE_ROOTS = ['article', 'main', '[role="main"]', '#content', 'body'];
const log = (...a) => DEBUG && console.log('[gemini-skill]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function waitFor(find, timeout = 10000) {
  return new Promise((resolve) => {
    const hit = find();
    if (hit) return resolve(hit);
    const done = (v) => { obs.disconnect(); clearTimeout(timer); resolve(v); };
    const obs = new MutationObserver(() => { const h = find(); if (h) done(h); });
    const timer = setTimeout(() => done(null), timeout);
    obs.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
  });
}

function sendToGemini(skill, prompt) {
  GM_setValue(KEY, { op: crypto.randomUUID(), skill, prompt, ts: Date.now() });
  GM_openInTab('https://gemini.google.com/app', { active: true, insert: true });
}

function summarizeVideo(videoUrl) {
  sendToGemini(VIDEO_SKILL, `Сделай содержательный разбор этого видео: ${videoUrl}`);
}

function addStyle(css) {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.append(style);
}

if (location.hostname === 'gemini.google.com') initGemini();
else if (location.hostname === 'www.youtube.com') initYouTube();
else initArticle();

function initYouTube() {
  const BTN_ID = 'yt-gemini-summary-btn';
  const CARD_BTN_CLASS = 'yt-gemini-card-btn';
  addStyle(`
    #${BTN_ID},.${CARD_BTN_CLASS}{border:0;cursor:pointer;white-space:nowrap;background:rgba(0,0,0,.05);color:#0f0f0f}
    #${BTN_ID}:hover,.${CARD_BTN_CLASS}:hover{background:rgba(0,0,0,.1)}
    html[dark] #${BTN_ID},html[dark] .${CARD_BTN_CLASS}{background:rgba(255,255,255,.1);color:#f1f1f1}
    html[dark] #${BTN_ID}:hover,html[dark] .${CARD_BTN_CLASS}:hover{background:rgba(255,255,255,.2)}
    #${BTN_ID}{height:40px;padding:0 16px;margin-left:8px;border-radius:20px;font:500 14px/40px Roboto,Arial,sans-serif;flex:none}
    .${CARD_BTN_CLASS}{display:block;align-self:flex-start;width:fit-content;height:24px;margin-top:6px;padding:0 10px;border-radius:12px;font:500 12px/24px Roboto,Arial,sans-serif}
    #${BTN_ID}.floating{position:fixed;right:24px;bottom:24px;z-index:2000;margin:0;box-shadow:0 2px 8px rgba(0,0,0,.3)}`);

  const btn = document.createElement('button');
  btn.id = BTN_ID;
  btn.type = 'button';
  btn.textContent = 'Суть видео';
  btn.title = `Gemini Skill: @${VIDEO_SKILL}`;
  btn.addEventListener('click', () => {
    const id = new URLSearchParams(location.search).get('v');
    if (!id) return;
    summarizeVideo(WATCH_URL + id);
  });

  const ROW = 'ytd-watch-metadata #top-level-buttons-computed';
  const attach = () => {
    const row = document.querySelector(ROW);
    if (row && btn.parentElement !== row) row.append(btn);
    return row;
  };
  let token = 0;
  let watched = null;
  async function place() {
    const my = ++token;
    if (location.pathname !== '/watch') return btn.remove();
    const row = await waitFor(() => document.querySelector(ROW), 8000);
    if (my !== token) return;
    if (!row) {
      btn.classList.add('floating');
      return document.body.append(btn);
    }
    btn.classList.remove('floating');
    attach();
    const meta = row.closest('ytd-watch-metadata');
    if (watched === meta) return;
    watched = meta;
    new MutationObserver(() => {
      if (location.pathname === '/watch' && !btn.classList.contains('floating')) attach();
    }).observe(meta, { childList: true, subtree: true });
  }

  document.addEventListener('yt-navigate-finish', place);
  place();
  initFeedButtons();

  function initFeedButtons() {
    const CARD_TAGS = ['ytd-rich-item-renderer', 'ytd-video-renderer', 'ytd-compact-video-renderer', 'yt-lockup-view-model'];
    const CARD_SELECTOR = CARD_TAGS.join(', ');
    const PENDING_CARD_SELECTOR = CARD_TAGS
      .map((tag) => `${tag}:not(:has(${CARD_SELECTOR})):not(:has(.${CARD_BTN_CLASS}))`)
      .join(', ');
    const CARD_SLOT_SELECTOR = '#metadata-line, yt-content-metadata-view-model';
    const WATCH_LINK_SELECTOR = 'a[href^="/watch?v="]';
    const VIDEO_ID_RE = /^[\w-]{11}$/;
    const SCAN_DELAY_MS = 250;
    let isScanScheduled = false;

    function getCardVideoId(card) {
      const href = card?.querySelector(WATCH_LINK_SELECTOR)?.getAttribute('href');
      if (!href) return null;
      const url = new URL(href, location.origin);
      if (url.searchParams.has('list')) return null;
      const id = url.searchParams.get('v');
      return VIDEO_ID_RE.test(id) ? id : null;
    }

    function createCardButton() {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = CARD_BTN_CLASS;
      button.textContent = 'Суть видео';
      button.title = `Gemini Skill: @${VIDEO_SKILL}`;
      button.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = getCardVideoId(e.currentTarget.closest(CARD_SELECTOR));
        if (id) summarizeVideo(WATCH_URL + id);
        else e.currentTarget.remove();
      });
      return button;
    }

    function addCardButtons() {
      isScanScheduled = false;
      for (const card of document.querySelectorAll(PENDING_CARD_SELECTOR)) {
        if (!getCardVideoId(card)) continue;
        const slot = card.querySelector(CARD_SLOT_SELECTOR);
        if (slot) slot.after(createCardButton());
      }
    }

    function scheduleCardScan() {
      if (isScanScheduled) return;
      isScanScheduled = true;
      setTimeout(addCardButtons, SCAN_DELAY_MS);
    }

    new MutationObserver(scheduleCardScan).observe(document.body, { childList: true, subtree: true });
    document.addEventListener('yt-navigate-finish', scheduleCardScan);
    scheduleCardScan();
  }
}

function getArticleText() {
  const selected = getSelection().toString().trim();
  if (selected) return selected;
  for (const sel of ARTICLE_ROOTS) {
    const text = document.querySelector(sel)?.innerText.trim() || '';
    if (text.length >= MIN_ARTICLE_CHARS) return text;
  }
  return '';
}

function initArticle() {
  const summarize = () => {
    const text = getArticleText().slice(0, MAX_ARTICLE_CHARS);
    const source = `«${document.title}» (${location.href})`;
    const prompt = text
      ? `Сделай выжимку статьи ${source}. Текст страницы ниже, ссылку открывать не нужно.\n\n${text}`
      : `Сделай выжимку статьи ${source}.`;
    sendToGemini(ARTICLE_SKILL, prompt);
  };

  GM_registerMenuCommand('Суть статьи (Alt+Shift+S)', summarize);
  document.addEventListener('keydown', (e) => {
    if (e.altKey && e.shiftKey && e.code === 'KeyS') { e.preventDefault(); summarize(); }
  });

  if ((document.querySelector('article')?.textContent.length || 0) < MIN_ARTICLE_CHARS) return;
  const BTN_ID = 'gemini-article-summary-btn';
  addStyle(`#${BTN_ID}{position:fixed;right:20px;bottom:20px;z-index:2147483646;padding:8px 14px;border:0;border-radius:18px;
    cursor:pointer;font:500 13px/1.2 system-ui,sans-serif;background:#1f1f1f;color:#fff;opacity:.55;box-shadow:0 2px 8px rgba(0,0,0,.3)}
    #${BTN_ID}:hover{opacity:1}`);
  const btn = document.createElement('button');
  btn.id = BTN_ID;
  btn.type = 'button';
  btn.textContent = 'Суть статьи';
  btn.title = `Gemini Skill: @${ARTICLE_SKILL} (Alt+Shift+S)`;
  btn.addEventListener('click', summarize);
  document.body.append(btn);
}

async function initGemini() {
  const job = GM_getValue(KEY);
  if (!job || Date.now() - job.ts > MAX_AGE_MS) return;
  const skill = job.skill || VIDEO_SKILL;
  const prompt = job.prompt || `Сделай содержательный разбор этого видео: ${job.url}`;

  const editor = () => document.querySelector('rich-textarea .ql-editor[contenteditable="true"]');
  const ed = await waitFor(editor, 60000);
  if (GM_getValue(KEY)?.op !== job.op) return;
  GM_deleteValue(KEY);
  log('job', job);

  if (!ed) return toast('Gemini не загрузился: поле ввода не найдено.');
  if (ed.textContent.trim()) return toast('В поле Gemini уже есть текст — не трогаю.');

  const typeText = (text) => {
    const e = editor();
    e.focus();
    const sel = getSelection();
    sel.selectAllChildren(e);
    sel.collapseToEnd();
    document.execCommand('insertText', false, text);
  };

  const findItem = () => [...document.querySelectorAll('#at-mentions-v2-panel button.at-mentions-v2-item')]
    .find((b) => b.querySelector('.at-mentions-v2-item-title')?.textContent.trim() === skill);
  let item = null;
  for (let attempt = 1; attempt <= 4 && !item; attempt++) {
    typeText('@');
    if (!await waitFor(() => document.querySelector('#at-mentions-v2-panel'), 1500)) {
      log('mention menu did not open, attempt', attempt);
      document.execCommand('delete');
      await sleep(500 * attempt);
      continue;
    }
    for (const ch of skill) {
      if (findItem()) break;
      typeText(ch);
      await sleep(60);
    }
    item = await waitFor(findItem, 3000);
    break;
  }

  if (!item) {
    const e = editor();
    e.focus();
    document.execCommand('selectAll');
    document.execCommand('insertText', false, prompt);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return toast(`Skill @${skill} не найден в меню @. Запрос вставлен, но не отправлен — выберите Skill вручную.`);
  }

  item.click();
  const chip = await waitFor(() => [...(editor()?.querySelectorAll('strong') || [])].find((s) => s.textContent.trim() === '@' + skill), 3000);
  if (!chip) return toast(`Не удалось подтвердить выбор Skill @${skill}. Ничего не отправлено.`);

  typeText(prompt);
  if (!AUTO_SEND) return;

  const send = await waitFor(() => document.querySelector('.send-button.submit:not(.stop) button:not([disabled])'), 5000);
  if (!send) return toast('Кнопка отправки не найдена — нажмите Enter вручную.');
  send.click();
  log('sent');
}

function toast(text) {
  log(text);
  const el = document.createElement('div');
  el.textContent = text;
  el.style.cssText = 'position:fixed;left:50%;top:16px;transform:translateX(-50%);z-index:99999;max-width:640px;padding:12px 16px;border-radius:12px;background:#b3261e;color:#fff;font:14px/1.4 sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.4);cursor:pointer';
  el.title = 'Закрыть';
  el.onclick = () => el.remove();
  document.body.append(el);
}
