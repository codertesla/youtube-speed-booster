// ==UserScript==
// @name         YouTube 播放速度增强
// @namespace    https://codex.local/userscripts
// @version      1.3.7
// @description  解锁 YouTube 2.0x 倍速上限，并把脚本中设置的速度自动保存为所有视频的默认播放速度。
// @description:en Unlock YouTube playback speeds above 2.0x and save one default speed for every video.
// @author       codertesla
// @license      MIT
// @homepageURL  https://github.com/codertesla/youtube-speed-booster
// @supportURL   https://github.com/codertesla/youtube-speed-booster/issues
// @downloadURL  https://update.greasyfork.org/scripts/585659/code.user.js
// @updateURL    https://update.greasyfork.org/scripts/585659/code.user.js
// @match        https://www.youtube.com/*
// @match        https://m.youtube.com/*
// @match        https://www.youtube-nocookie.com/*
// @icon         https://www.youtube.com/favicon.ico
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const STORAGE = {
    defaultRate: 'ytSpeedUnlocker.defaultRate',
    showPanel: 'ytSpeedUnlocker.showPanel',
  };

  const DEFAULT_RATE = 1.5;
  const MIN_RATE = 0.1;
  const MAX_RATE = 16;
  const SLIDER_MIN = 0.25;
  const SLIDER_MAX = 5;
  const RATE_STEP = 0.05;
  const APPLY_RETRIES = [0, 80, 250, 600, 1200, 2500];

  let currentVideoKey = '';
  let activeVideo = null;
  let speedButton = null;
  let speedPanel = null;
  let fallbackPanel = null;
  let internalRateChange = false;
  let nativeControlObserver = null;
  let scanTimer = 0;
  let historyHooksInstalled = false;
  let outsideClickInstalled = false;
  let menuCommandIds = [];

  const clampRate = (value) => {
    const rate = Number(value);
    if (!Number.isFinite(rate)) return DEFAULT_RATE;
    return Math.min(MAX_RATE, Math.max(MIN_RATE, Math.round(rate * 100) / 100));
  };

  const formatRate = (rate) => `${clampRate(rate).toFixed(2)}x`;
  const getDefaultRate = () => clampRate(GM_getValue(STORAGE.defaultRate, DEFAULT_RATE));
  const formatDefaultRateLabel = () => `当前默认：${formatRate(getDefaultRate())}`;
  const setDefaultRate = (rate) => GM_setValue(STORAGE.defaultRate, clampRate(rate));
  const getShowPanel = () => GM_getValue(STORAGE.showPanel, true);
  const setShowPanel = (enabled) => GM_setValue(STORAGE.showPanel, Boolean(enabled));

  const isVideoPage = () => {
    const path = location.pathname;
    return path === '/watch' || path.startsWith('/shorts/') || path.startsWith('/embed/');
  };

  const getVideoKey = () => {
    if (location.pathname === '/watch') {
      return new URLSearchParams(location.search).get('v') || location.href;
    }
    if (location.pathname.startsWith('/shorts/') || location.pathname.startsWith('/embed/')) {
      return location.pathname;
    }
    return '';
  };

  const getVideo = () => {
    const candidates = Array.from(document.querySelectorAll('video'));
    return candidates.find((video) => video.src || video.currentSrc) || candidates[0] || null;
  };

  const getCurrentRate = () => {
    const video = getVideo();
    return video ? clampRate(video.playbackRate) : getDefaultRate();
  };

  const syncControls = () => {
    const rate = getCurrentRate();
    if (speedButton) {
      speedButton.textContent = formatRate(rate);
      speedButton.setAttribute('aria-label', `Playback speed ${formatRate(rate)}`);
      speedButton.title = `Playback speed ${formatRate(rate)}`;
    }
    document.querySelectorAll('[data-ytsu-current-rate]').forEach((node) => {
      node.textContent = formatRate(rate);
    });
    document.querySelectorAll('[data-ytsu-slider]').forEach((node) => {
      node.value = String(Math.min(SLIDER_MAX, Math.max(SLIDER_MIN, rate)));
    });
    document.querySelectorAll('[data-ytsu-number]').forEach((node) => {
      if (document.activeElement !== node) node.value = String(rate);
    });
    document.querySelectorAll('[data-ytsu-default-rate]').forEach((node) => {
      node.textContent = formatDefaultRateLabel();
    });
    if (speedPanel && !speedPanel.hidden) window.requestAnimationFrame(positionSpeedPanel);
  };

  const applyRate = (rate, options = {}) => {
    const video = options.video || getVideo();
    if (!video) return false;

    const nextRate = clampRate(rate);
    activeVideo = video;
    internalRateChange = true;
    video.playbackRate = nextRate;
    video.defaultPlaybackRate = nextRate;
    window.setTimeout(() => {
      internalRateChange = false;
      syncControls();
    }, 0);
    syncControls();
    return true;
  };

  const applyDefaultToCurrentVideo = () => {
    if (!isVideoPage()) return;
    const video = getVideo();
    if (!video) return;

    activeVideo = video;
    const defaultRate = getDefaultRate();
    APPLY_RETRIES.forEach((delay) => {
      window.setTimeout(() => applyRate(defaultRate, { video }), delay);
    });
  };

  const attachToVideo = () => {
    const video = getVideo();
    if (!video || video === activeVideo) return;

    activeVideo = video;
    video.addEventListener('loadedmetadata', () => {
      if (isVideoPage()) applyRate(getDefaultRate(), { video });
    });
    video.addEventListener('ratechange', () => {
      if (!internalRateChange) syncControls();
    });
    syncControls();
  };

  const scanPage = () => {
    if (!isVideoPage()) {
      currentVideoKey = '';
      removeInjectedControls();
      return;
    }

    attachToVideo();
    injectNativeButton();
    const nextKey = getVideoKey();
    if (nextKey && nextKey !== currentVideoKey) {
      currentVideoKey = nextKey;
      applyDefaultToCurrentVideo();
    }
  };

  const scheduleScan = (delay = 120) => {
    if (scanTimer) return;
    scanTimer = window.setTimeout(() => {
      scanTimer = 0;
      scanPage();
    }, delay);
  };

  const mutationLooksRelevant = (mutations) => {
    const selectors = 'video, .html5-video-player, .ytp-right-controls, .ytp-chrome-bottom, ytd-watch-flexy, ytd-player';
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.matches?.(selectors) || node.querySelector?.(selectors)) return true;
      }
    }
    return false;
  };

  const installHistoryHooks = () => {
    if (historyHooksInstalled) return;
    historyHooksInstalled = true;
    ['pushState', 'replaceState'].forEach((method) => {
      const original = history[method];
      if (typeof original !== 'function') return;
      history[method] = function (...args) {
        try {
          return original.apply(this, args);
        } finally {
          window.setTimeout(() => {
            window.dispatchEvent(new Event('yt-speed-unlocker-location-change'));
          }, 0);
        }
      };
    });
  };

  const setSpeed = (rate) => {
    const nextRate = clampRate(rate);
    setDefaultRate(nextRate);
    applyRate(nextRate);
    syncControls();
    registerMenus();
  };

  const hidePanels = () => {
    if (speedPanel) speedPanel.hidden = true;
    if (fallbackPanel) fallbackPanel.hidden = true;
  };

  const openSpeedPanel = () => {
    if (!isVideoPage()) return;

    setShowPanel(true);
    injectNativeButton();

    if (speedPanel) {
      if (fallbackPanel) fallbackPanel.hidden = true;
      speedPanel.hidden = false;
      syncControls();
      window.requestAnimationFrame(positionSpeedPanel);
      return;
    }

    installFallbackPanel();
  };

  const removeInjectedControls = () => {
    hidePanels();
    if (speedButton?.parentNode) speedButton.parentNode.removeChild(speedButton);
  };

  const shouldUseNativePopover = () => window.matchMedia('(min-width: 641px)').matches;

  const positionSpeedPanel = () => {
    if (!speedPanel || !speedButton || speedPanel.hidden || !shouldUseNativePopover()) return;

    const player = document.querySelector('.html5-video-player');
    if (!player) return;

    const playerRect = player.getBoundingClientRect();
    const buttonRect = speedButton.getBoundingClientRect();
    const panelRect = speedPanel.getBoundingClientRect();
    const margin = 10;
    const controlsGap = 10;
    const width = panelRect.width || 320;
    const height = panelRect.height || 210;
    const rawLeft = buttonRect.left - playerRect.left + buttonRect.width / 2 - width / 2;
    const left = Math.max(margin, Math.min(rawLeft, playerRect.width - width - margin));
    const top = Math.max(margin, buttonRect.top - playerRect.top - height - controlsGap);

    speedPanel.style.left = `${Math.round(left)}px`;
    speedPanel.style.top = `${Math.round(top)}px`;
  };

  const registerMenus = () => {
    const canRefreshMenus = typeof GM_unregisterMenuCommand === 'function';
    if (canRefreshMenus) {
      menuCommandIds.forEach((id) => GM_unregisterMenuCommand(id));
      menuCommandIds = [];
    } else if (menuCommandIds.length) {
      return;
    }

    const setRateMenuId = GM_registerMenuCommand(`设置倍速（${formatDefaultRateLabel()}）`, () => {
      openSpeedPanel();
    });
    if (setRateMenuId !== undefined) menuCommandIds.push(setRateMenuId);

    const disableSpeedMenuId = GM_registerMenuCommand('关闭倍速功能', () => {
      setSpeed(1);
      hidePanels();
    });
    if (disableSpeedMenuId !== undefined) menuCommandIds.push(disableSpeedMenuId);
  };

  const installStyles = () => {
    if (document.getElementById('yt-speed-unlocker-styles')) return;

    const style = document.createElement('style');
    style.id = 'yt-speed-unlocker-styles';
    style.textContent = `
      .ytp-button.yt-speed-unlocker-button {
        width: auto !important;
        min-width: 52px !important;
        padding: 0 8px !important;
        color: #fff !important;
        font: 700 13px/48px Arial, sans-serif !important;
        text-align: center !important;
      }
      .ytp-small-mode .ytp-button.yt-speed-unlocker-button {
        min-width: 46px !important;
        padding: 0 5px !important;
        font-size: 12px !important;
      }
      #yt-speed-unlocker-popover,
      #yt-speed-unlocker-fallback {
        color: #f7f7f7;
        background: rgba(15, 15, 15, 0.82);
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 18px;
        box-shadow: 0 10px 34px rgba(0, 0, 0, 0.36);
        font: 14px/1.35 Roboto, Arial, sans-serif;
        -webkit-backdrop-filter: blur(16px);
        backdrop-filter: blur(16px);
      }
      #yt-speed-unlocker-popover {
        position: absolute;
        z-index: 2147483647;
        width: 320px;
        padding: 0;
        transform-origin: 50% 100%;
      }
      #yt-speed-unlocker-popover[hidden],
      #yt-speed-unlocker-fallback[hidden] {
        display: none !important;
      }
      #yt-speed-unlocker-popover .yt-speed-header,
      #yt-speed-unlocker-fallback .yt-speed-header {
        display: flex;
        align-items: center;
        gap: 10px;
        height: 44px;
        padding: 0 12px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.14);
      }
      #yt-speed-unlocker-popover .yt-speed-body,
      #yt-speed-unlocker-fallback .yt-speed-body {
        padding: 14px;
      }
      #yt-speed-unlocker-popover .yt-speed-title,
      #yt-speed-unlocker-fallback .yt-speed-title {
        flex: 1;
        margin: 0;
        font-size: 15px;
        font-weight: 700;
      }
      #yt-speed-unlocker-popover .yt-speed-default-badge,
      #yt-speed-unlocker-fallback .yt-speed-default-badge {
        color: rgba(255, 255, 255, 0.76);
        font-size: 12px;
        font-weight: 500;
        white-space: nowrap;
      }
      #yt-speed-unlocker-popover .yt-speed-icon-button,
      #yt-speed-unlocker-fallback .yt-speed-icon-button {
        width: 32px;
        height: 32px;
        padding: 0;
        color: #fff;
        background: rgba(255, 255, 255, 0.08);
        border: 0;
        border-radius: 50%;
        cursor: pointer;
        font: 400 24px/32px Arial, sans-serif;
      }
      #yt-speed-unlocker-popover .yt-speed-icon-button:hover,
      #yt-speed-unlocker-fallback .yt-speed-icon-button:hover {
        background: rgba(255, 255, 255, 0.16);
      }
      #yt-speed-unlocker-popover .yt-speed-rate,
      #yt-speed-unlocker-fallback .yt-speed-rate {
        margin: 0 0 10px;
        text-align: center;
        font-size: 26px;
        font-weight: 700;
      }
      #yt-speed-unlocker-popover .yt-speed-slider-row,
      #yt-speed-unlocker-fallback .yt-speed-slider-row {
        display: grid;
        grid-template-columns: 36px 1fr 36px;
        align-items: center;
        gap: 10px;
      }
      #yt-speed-unlocker-popover input[type="range"],
      #yt-speed-unlocker-fallback input[type="range"] {
        width: 100%;
        accent-color: #fff;
      }
      #yt-speed-unlocker-popover .yt-speed-step,
      #yt-speed-unlocker-fallback .yt-speed-step {
        width: 36px;
        height: 36px;
        padding: 0;
        color: #fff;
        background: rgba(255, 255, 255, 0.12);
        border: 0;
        border-radius: 50%;
        cursor: pointer;
        font: 700 24px/36px Arial, sans-serif;
      }
      #yt-speed-unlocker-popover .yt-speed-chip-row,
      #yt-speed-unlocker-fallback .yt-speed-chip-row {
        display: grid;
        grid-template-columns: repeat(5, minmax(0, 1fr));
        gap: 7px;
        margin: 12px 0 10px;
      }
      #yt-speed-unlocker-popover .yt-speed-chip,
      #yt-speed-unlocker-fallback .yt-speed-chip {
        min-height: 34px;
        padding: 0 6px;
        color: #fff;
        background: rgba(255, 255, 255, 0.1);
        border: 0;
        border-radius: 17px;
        cursor: pointer;
        font: 500 13px/1 Roboto, Arial, sans-serif;
      }
      #yt-speed-unlocker-popover input[type="number"],
      #yt-speed-unlocker-fallback input[type="number"] {
        width: 76px;
        padding: 6px 8px;
        color: #fff;
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.18);
        border-radius: 9px;
        font-size: 13px;
      }
      #yt-speed-unlocker-popover .yt-speed-exact-row,
      #yt-speed-unlocker-fallback .yt-speed-exact-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-top: 12px;
      }
      #yt-speed-unlocker-fallback .yt-speed-header {
        height: 54px;
        padding: 0 18px;
        gap: 12px;
      }
      #yt-speed-unlocker-fallback .yt-speed-body {
        padding: 18px;
      }
      #yt-speed-unlocker-fallback .yt-speed-title {
        font-size: 18px;
      }
      #yt-speed-unlocker-fallback .yt-speed-default-badge {
        font-size: 14px;
      }
      #yt-speed-unlocker-fallback .yt-speed-icon-button {
        width: 40px;
        height: 40px;
        font: 400 28px/40px Arial, sans-serif;
      }
      #yt-speed-unlocker-fallback .yt-speed-rate {
        margin: 0 0 14px;
        font-size: 30px;
      }
      #yt-speed-unlocker-fallback .yt-speed-slider-row {
        grid-template-columns: 48px 1fr 48px;
        gap: 14px;
      }
      #yt-speed-unlocker-fallback .yt-speed-step {
        width: 48px;
        height: 48px;
        font: 700 30px/48px Arial, sans-serif;
      }
      #yt-speed-unlocker-fallback .yt-speed-chip-row {
        gap: 10px;
        margin: 18px 0 12px;
      }
      #yt-speed-unlocker-fallback .yt-speed-chip {
        min-height: 44px;
        padding: 0 8px;
        border-radius: 22px;
        font: 500 16px/1 Roboto, Arial, sans-serif;
      }
      #yt-speed-unlocker-fallback input[type="number"] {
        width: 88px;
        padding: 8px 10px;
        border-radius: 12px;
        font-size: 16px;
      }
      #yt-speed-unlocker-fallback {
        position: absolute;
        left: 50%;
        bottom: 76px;
        transform: translateX(-50%);
        z-index: 2147483647;
        width: min(560px, calc(100% - 24px));
        padding: 0;
      }
      #yt-speed-unlocker-fallback.yt-speed-fixed {
        position: fixed;
        left: 50%;
        bottom: 76px;
      }
      @media (max-width: 640px) {
        #yt-speed-unlocker-popover,
        #yt-speed-unlocker-fallback {
          width: calc(100% - 14px);
          left: 7px !important;
          top: auto !important;
          bottom: 10px;
          border-radius: 16px;
        }
        #yt-speed-unlocker-popover .yt-speed-body,
        #yt-speed-unlocker-fallback .yt-speed-body {
          padding: 16px;
        }
        #yt-speed-unlocker-popover .yt-speed-chip-row,
        #yt-speed-unlocker-fallback .yt-speed-chip-row {
          gap: 8px;
        }
      }
    `;
    document.documentElement.appendChild(style);
  };

  const createSpeedPanel = (id) => {
    const root = document.createElement('div');
    root.id = id;
    if (id === 'yt-speed-unlocker-popover') root.hidden = true;

    const header = document.createElement('div');
    header.className = 'yt-speed-header';

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'yt-speed-icon-button';
    closeButton.textContent = id === 'yt-speed-unlocker-popover' ? '×' : '‹';
    closeButton.title = 'Close speed panel';
    closeButton.addEventListener('click', () => {
      root.hidden = true;
      if (root.id === 'yt-speed-unlocker-fallback') setShowPanel(false);
    });
    header.appendChild(closeButton);

    const title = document.createElement('div');
    title.className = 'yt-speed-title';
    title.textContent = 'Playback speed';
    header.appendChild(title);

    const defaultBadge = document.createElement('div');
    defaultBadge.className = 'yt-speed-default-badge';
    defaultBadge.textContent = formatDefaultRateLabel();
    defaultBadge.dataset.ytsuDefaultRate = 'true';
    header.appendChild(defaultBadge);

    root.appendChild(header);

    const body = document.createElement('div');
    body.className = 'yt-speed-body';

    const speedLabel = document.createElement('div');
    speedLabel.className = 'yt-speed-rate';
    speedLabel.dataset.ytsuCurrentRate = 'true';
    speedLabel.textContent = formatRate(getCurrentRate());
    body.appendChild(speedLabel);

    const sliderRow = document.createElement('div');
    sliderRow.className = 'yt-speed-slider-row';

    const minus = document.createElement('button');
    minus.type = 'button';
    minus.className = 'yt-speed-step';
    minus.textContent = '-';
    minus.title = 'Decrease speed by 0.25x';
    minus.addEventListener('click', () => setSpeed(getCurrentRate() - 0.25));
    sliderRow.appendChild(minus);

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = String(SLIDER_MIN);
    slider.max = String(SLIDER_MAX);
    slider.step = String(RATE_STEP);
    slider.value = String(Math.min(SLIDER_MAX, Math.max(SLIDER_MIN, getCurrentRate())));
    slider.title = 'Drag to set current speed';
    slider.dataset.ytsuSlider = 'true';
    slider.addEventListener('input', () => setSpeed(slider.value));
    sliderRow.appendChild(slider);

    const plus = document.createElement('button');
    plus.type = 'button';
    plus.className = 'yt-speed-step';
    plus.textContent = '+';
    plus.title = 'Increase speed by 0.25x';
    plus.addEventListener('click', () => setSpeed(getCurrentRate() + 0.25));
    sliderRow.appendChild(plus);

    body.appendChild(sliderRow);

    const chipRow = document.createElement('div');
    chipRow.className = 'yt-speed-chip-row';
    [1, 1.25, 1.5, 2, 3].forEach((rate) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'yt-speed-chip';
      chip.textContent = rate === 1 ? '1.0' : String(rate);
      chip.title = `Set ${formatRate(rate)}`;
      chip.addEventListener('click', () => setSpeed(rate));
      chipRow.appendChild(chip);
    });
    body.appendChild(chipRow);

    const exactRow = document.createElement('div');
    exactRow.className = 'yt-speed-exact-row';
    const exactLabel = document.createElement('span');
    exactLabel.textContent = 'Exact speed';
    exactRow.appendChild(exactLabel);

    const numberInput = document.createElement('input');
    numberInput.type = 'number';
    numberInput.min = String(MIN_RATE);
    numberInput.max = String(MAX_RATE);
    numberInput.step = String(RATE_STEP);
    numberInput.value = String(getCurrentRate());
    numberInput.title = 'Exact speed, supports 0.1x to 16x';
    numberInput.dataset.ytsuNumber = 'true';
    numberInput.addEventListener('change', () => setSpeed(numberInput.value));
    exactRow.appendChild(numberInput);
    body.appendChild(exactRow);

    root.appendChild(body);

    return root;
  };

  const injectNativeButton = () => {
    if (!document.body) return false;
    if (!isVideoPage()) {
      removeInjectedControls();
      return false;
    }
    installStyles();

    const rightControls = document.querySelector('.ytp-right-controls, .ytp-chrome-controls .ytp-right-controls');
    const player = document.querySelector('.html5-video-player');
    if (!rightControls || !player) {
      installFallbackPanel();
      return false;
    }

    if (!speedButton || !rightControls.contains(speedButton)) {
      speedButton = document.createElement('button');
      speedButton.type = 'button';
      speedButton.className = 'ytp-button yt-speed-unlocker-button';
      speedButton.addEventListener('click', (event) => {
        event.stopPropagation();
        if (!speedPanel) return;
        const willShow = speedPanel.hidden;
        speedPanel.hidden = !willShow;
        syncControls();
        if (willShow) window.requestAnimationFrame(positionSpeedPanel);
      });

      const settingsButton = rightControls.querySelector('.ytp-settings-button');
      rightControls.insertBefore(speedButton, settingsButton || rightControls.firstChild);
    }

    if (!speedPanel || speedPanel.id !== 'yt-speed-unlocker-popover') {
      if (speedPanel && speedPanel.parentNode) speedPanel.parentNode.removeChild(speedPanel);
      speedPanel = createSpeedPanel('yt-speed-unlocker-popover');
      player.appendChild(speedPanel);
      if (!outsideClickInstalled) {
        outsideClickInstalled = true;
        document.addEventListener('click', (event) => {
          if (!speedPanel || speedPanel.hidden) return;
          if (speedPanel.contains(event.target) || speedButton.contains(event.target)) return;
          speedPanel.hidden = true;
        }, true);
        window.addEventListener('resize', () => window.requestAnimationFrame(positionSpeedPanel));
      }
    }

    if (fallbackPanel) fallbackPanel.hidden = true;
    syncControls();
    return true;
  };

  const installFallbackPanel = () => {
    if (!document.body || !getShowPanel() || !isVideoPage()) {
      hidePanels();
      return;
    }
    installStyles();
    if (!fallbackPanel) fallbackPanel = createSpeedPanel('yt-speed-unlocker-fallback');

    const player = document.querySelector('.html5-video-player');
    if (player) {
      fallbackPanel.classList.remove('yt-speed-fixed');
      if (fallbackPanel.parentNode !== player) player.appendChild(fallbackPanel);
    } else {
      fallbackPanel.classList.add('yt-speed-fixed');
      if (fallbackPanel.parentNode !== document.body) document.body.appendChild(fallbackPanel);
    }
    fallbackPanel.hidden = false;
    syncControls();
  };

  const installYouTubeHooks = () => {
    window.addEventListener('yt-navigate-finish', () => scheduleScan(40), true);
    window.addEventListener('yt-page-data-updated', () => scheduleScan(80), true);
    window.addEventListener('yt-speed-unlocker-location-change', () => scheduleScan(80), true);
    window.addEventListener('popstate', () => scheduleScan(80), true);
    window.addEventListener('focus', () => scheduleScan(80), true);

    nativeControlObserver = new MutationObserver((mutations) => {
      if (mutationLooksRelevant(mutations)) scheduleScan(180);
    });

    const startObserver = () => {
      if (document.documentElement) {
        nativeControlObserver.observe(document.documentElement, { childList: true, subtree: true });
      } else {
        window.setTimeout(startObserver, 50);
      }
    };
    startObserver();
  };

  const boot = () => {
    installHistoryHooks();
    installYouTubeHooks();
    registerMenus();

    const ready = () => {
      scheduleScan(0);
      APPLY_RETRIES.forEach((delay) => {
        window.setTimeout(() => {
          applyDefaultToCurrentVideo();
        }, delay);
      });
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', ready, { once: true });
    } else {
      ready();
    }
  };

  boot();
})();
