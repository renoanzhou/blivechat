const seatGrid = document.getElementById('seat-grid');
const leaderboardEl = document.getElementById('leaderboard');
const waitlistEl = document.getElementById('waitlist');
const messagesEl = document.getElementById('messages');
const connectionDot = document.getElementById('connection-indicator');
const connectionLabel = document.getElementById('connection-label');
const debugForm = document.getElementById('debug-form');
const danmakuListEl = document.getElementById('danmaku-list');
const debugPanel = document.querySelector('.panel.debug');
const joinBanner = document.getElementById('join-banner');
const joinAvailableCountEl = document.getElementById('join-available-count');
const joinCommandPrimaryEl = document.getElementById('join-command-primary');
const joinActivityHintEl = document.getElementById('join-activity-hint');
const debugCommandExamplesEl = document.getElementById('debug-command-examples');
const toastContainer = document.getElementById('toast-container');

const seatElements = new Map();
const danmakuMessages = [];
const danmakuMap = new Map();

const POLL_INTERVAL_MS = 5000;
const MAX_DANMAKU_MESSAGES = 80;
const TOAST_TIMEOUT_MS = 4500;

const MESSAGE_TYPE_TEXT = 0;
const MESSAGE_TYPE_GIFT = 1;
const MESSAGE_TYPE_MEMBER = 2;
const MESSAGE_TYPE_SUPER_CHAT = 3;

let currentSnapshot = null;
let pollTimer = null;
let roomInfo = { roomKeyType: 1, roomKeyValue: null };
let blcInitData = null;
let isFetchingState = false;
let pendingFetchState = false;
let refreshTimer = null;
const recentEventKeys = new Set();
const recentEventQueue = [];

const timeFormatter = new Intl.DateTimeFormat('zh-CN', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

function setConnectionState(isOnline) {
  if (isOnline) {
    connectionDot.classList.add('is-online');
    connectionDot.classList.remove('is-offline');
    connectionLabel.textContent = '已连接';
  } else {
    connectionDot.classList.remove('is-online');
    connectionDot.classList.add('is-offline');
    connectionLabel.textContent = '连接中断';
  }
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds
      .toString()
      .padStart(2, '0')}`;
  }

  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

function statusLabel(status) {
  switch (status) {
    case 'study':
      return '学习中';
    case 'rest':
      return '休息中';
    case 'away':
      return '已离开';
    case 'idle':
      return '准备中';
    default:
      return '空位';
  }
}

function ensureSeatElements(seats) {
  if (seatElements.size) {
    return;
  }
  const rows = Math.max(...seats.map((seat) => seat.row)) + 1;
  const cols = Math.max(...seats.map((seat) => seat.col)) + 1;
  seatGrid.style.setProperty('--grid-rows', rows);
  seatGrid.style.setProperty('--grid-cols', cols);

  seats
    .slice()
    .sort((a, b) => {
      if (a.row === b.row) {
        return a.col - b.col;
      }
      return a.row - b.row;
    })
    .forEach((seat) => {
      const seatElement = document.createElement('div');
      seatElement.className = 'seat is-empty';
      seatElement.dataset.id = seat.id;
      seatElement.dataset.status = 'empty';

      seatElement.innerHTML = `
        <div class="seat__label">
          <span></span>
          <span>📚</span>
        </div>
        <div class="seat__occupant">
          <span class="seat__status-dot"></span>
          <div class="seat__meta">
            <div class="seat__name">空位</div>
            <div class="seat__status">等待加入</div>
          </div>
        </div>
      `;

      seatGrid.appendChild(seatElement);
      seatElements.set(seat.id, seatElement);
    });
}

function updateSeats(seats) {
  seats.forEach((seat) => {
    const element = seatElements.get(seat.id);
    if (!element) {
      return;
    }
    const nameNode = element.querySelector('.seat__name');
    const statusNode = element.querySelector('.seat__status');

    if (seat.occupant) {
      element.classList.remove('is-empty');
      element.dataset.status = seat.occupant.status || 'idle';
      nameNode.textContent = seat.occupant.name;
      statusNode.textContent = statusLabel(seat.occupant.status);
    } else {
      element.classList.add('is-empty');
      element.dataset.status = 'empty';
      nameNode.textContent = '空位';
      statusNode.textContent = '等待加入';
    }
  });
}

function updateLeaderboard(leaderboard) {
  leaderboardEl.innerHTML = '';
  if (!leaderboard.length) {
    const empty = document.createElement('li');
    empty.textContent = '暂无上榜学习者';
    leaderboardEl.appendChild(empty);
    return;
  }

  leaderboard.forEach((entry, index) => {
    const li = document.createElement('li');
    const badge = ['🥇', '🥈', '🥉'][index] || '📖';
    li.innerHTML = `
      <span>${badge}</span>
      <span class="leaderboard__name">${entry.name}</span>
      <span class="leaderboard__time">${formatDuration(entry.totalStudyMs)}</span>
    `;
    leaderboardEl.appendChild(li);
  });
}

function updateMessages(logs) {
  messagesEl.innerHTML = '';
  logs.forEach((item) => {
    const li = document.createElement('li');
    const time = document.createElement('time');
    time.dateTime = new Date(item.timestamp).toISOString();
    time.textContent = timeFormatter.format(item.timestamp);
    li.textContent = item.message;
    li.appendChild(time);
    messagesEl.appendChild(li);
  });
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function updateJoinPrompt(prompt, activityConfig) {
  if (!joinBanner || !joinAvailableCountEl || !joinCommandPrimaryEl) {
    return;
  }
  const available = prompt && typeof prompt.availableSeatCount === 'number' ? prompt.availableSeatCount : 0;
  joinAvailableCountEl.textContent = String(available);
  if (prompt && typeof prompt.primaryCommand === 'string' && prompt.primaryCommand.trim()) {
    joinCommandPrimaryEl.textContent = prompt.primaryCommand;
  }
  if (joinActivityHintEl) {
    joinActivityHintEl.textContent = formatActivityHint(activityConfig);
  }
  if (available > 0) {
    joinBanner.classList.remove('is-hidden');
  } else {
    joinBanner.classList.add('is-hidden');
  }
}

function formatActivityHint(activityConfig) {
  if (!activityConfig) {
    return '';
  }
  const windowMinutes = Math.max(1, Math.round((activityConfig.activityWindowMs ?? 0) / 60000));
  const minMessages = Math.max(1, activityConfig.activityMinMessages ?? 1);
  return `保持座位：${windowMinutes} 分钟内发送至少 ${minMessages} 条弹幕`;
}

function updateDebugExamples(prompt) {
  if (!debugCommandExamplesEl) {
    return;
  }
  const prefix = prompt && Array.isArray(prompt.prefixes) && prompt.prefixes.length ? prompt.prefixes[0] : '/';
  const joinExample =
    prompt && typeof prompt.primaryCommand === 'string' && prompt.primaryCommand.trim()
      ? prompt.primaryCommand
      : `${prefix}加入图书馆`;
  const leaveAliases = prompt && Array.isArray(prompt.leaveAliases) ? prompt.leaveAliases : [];
  const leaveExample = leaveAliases.length ? `${prefix}${leaveAliases[0]}` : `${prefix}离开座位`;
  debugCommandExamplesEl.textContent = `${joinExample}、${leaveExample}`;
}

function updateWaitlist(waitlist) {
  if (!waitlistEl) {
    return;
  }
  waitlistEl.innerHTML = '';
  if (!Array.isArray(waitlist) || waitlist.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'waitlist__empty';
    empty.textContent = '当前没有候补观众';
    waitlistEl.appendChild(empty);
    return;
  }
  waitlist.forEach((entry) => {
    const li = document.createElement('li');
    li.className = 'waitlist__item';
    const position = document.createElement('span');
    position.className = 'waitlist__pos';
    position.textContent = String(entry.position ?? '-');
    const name = document.createElement('span');
    name.className = 'waitlist__name';
    name.textContent = entry.name || '匿名观众';
    li.appendChild(position);
    li.appendChild(name);
    waitlistEl.appendChild(li);
  });
}

function handleRecentEvents(events) {
  if (!Array.isArray(events)) {
    return;
  }
  events.forEach((event) => {
    if (!event || typeof event !== 'object') {
      return;
    }
    const key = `${event.type}:${event.userId ?? event.username}:${event.timestamp}`;
    if (!key || recentEventKeys.has(key)) {
      return;
    }
    recentEventKeys.add(key);
    recentEventQueue.push(key);
    if (recentEventQueue.length > 200) {
      const oldest = recentEventQueue.shift();
      if (oldest) {
        recentEventKeys.delete(oldest);
      }
    }
    const message = buildToastMessage(event);
    if (!message) {
      return;
    }
    const variant = toastVariantFor(event.type);
    showToast(message, variant);
  });
}

function buildToastMessage(event) {
  const name = event.username || '观众';
  const seat = event.seatLabel ? ` ${event.seatLabel}` : '';
  switch (event.type) {
    case 'join':
      return `${name} 成功入座${seat}`;
    case 'waitlist':
      return `${name} 加入候补队列`;
    case 'waitlist_promoted':
      return `${name} 从候补进入${seat}`;
    case 'leave':
      return `${name} 离开了座位`;
    case 'auto_leave':
      return `${name} 因长时间未互动被移出`;
    default:
      return '';
  }
}

function toastVariantFor(type) {
  switch (type) {
    case 'join':
    case 'waitlist_promoted':
      return 'success';
    case 'waitlist':
      return 'info';
    case 'auto_leave':
      return 'warning';
    case 'leave':
      return 'neutral';
    default:
      return 'info';
  }
}

function showToast(text, variant = 'info') {
  if (!toastContainer || !text) {
    return;
  }
  const toast = document.createElement('div');
  toast.className = `toast toast--${variant}`;
  toast.textContent = text;
  toastContainer.appendChild(toast);
  requestAnimationFrame(() => {
    toast.classList.add('is-visible');
  });
  setTimeout(() => {
    toast.classList.remove('is-visible');
    setTimeout(() => toast.remove(), 280);
  }, TOAST_TIMEOUT_MS);
  while (toastContainer.childElementCount > 5) {
    toastContainer.removeChild(toastContainer.firstChild);
  }
}

function resolveDanmakuTime(message) {
  if (!message) {
    return new Date();
  }
  if (message.addTime instanceof Date) {
    return message.addTime;
  }
  if (message.time instanceof Date) {
    return message.time;
  }
  if (typeof message.timestamp === 'number') {
    const ts = message.timestamp > 1e12 ? message.timestamp : message.timestamp * 1000;
    return new Date(ts);
  }
  if (typeof message.time === 'number') {
    const ts = message.time > 1e12 ? message.time : message.time * 1000;
    return new Date(ts);
  }
  if (typeof message.addTime === 'number') {
    const ts = message.addTime > 1e12 ? message.addTime : message.addTime * 1000;
    return new Date(ts);
  }
  if (typeof message.addTime === 'string' && message.addTime) {
    const parsed = new Date(message.addTime);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  if (typeof message.time === 'string' && message.time) {
    const parsed = new Date(message.time);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  return new Date();
}

function formatContentParts(parts) {
  if (!Array.isArray(parts)) {
    return '';
  }
  return parts
    .map((part) => {
      if (!part) {
        return '';
      }
      if (typeof part === 'string') {
        return part;
      }
      if (typeof part.text === 'string') {
        return part.text;
      }
      return '';
    })
    .join('');
}

function getTextContentFromMessage(message) {
  if (!message || typeof message !== 'object') {
    return '';
  }
  if (typeof message.content === 'string' && message.content.trim() !== '') {
    return message.content;
  }
  if (typeof message.message === 'string' && message.message.trim() !== '') {
    return message.message;
  }
  const partsText = formatContentParts(message.contentParts);
  if (partsText.trim() !== '') {
    return partsText;
  }
  return '';
}

function formatDanmakuDisplay(message) {
  const display = {
    content: '',
    translation: '',
    tag: null,
    extraTags: [],
  };

  if (!message || typeof message !== 'object') {
    return display;
  }

  const repeated = Number(message.repeated) || 1;
  if (repeated > 1) {
    display.extraTags.push(`x${repeated}`);
  }

  switch (message.type) {
    case MESSAGE_TYPE_GIFT: {
      display.tag = '礼物';
      const giftName = message.giftName || '神秘礼物';
      const num = Number(message.num) || 1;
      const multiplier = num > 1 ? ` ×${num}` : '';
      display.content = `赠送 ${giftName}${multiplier}`;
      if (typeof message.price === 'number' && message.price > 0) {
        display.extraTags.push(`¥${message.price}`);
      }
      break;
    }
    case MESSAGE_TYPE_MEMBER: {
      display.tag = '上舰';
      display.content = message.title || '加入大航海';
      if (typeof message.num === 'number' && message.num > 1) {
        const unit = message.unit || '';
        display.extraTags.push(`${message.num}${unit}`);
      }
      break;
    }
    case MESSAGE_TYPE_SUPER_CHAT: {
      display.tag = '醒目留言';
      const price = typeof message.price === 'number' && message.price > 0 ? `¥${message.price}` : '';
      display.content = message.content || '';
      if (price) {
        display.extraTags.push(price);
      }
      if (message.translation) {
        display.translation = message.translation;
      }
      break;
    }
    default: {
      display.content = getTextContentFromMessage(message) || '（无内容）';
      if (message.translation) {
        display.translation = message.translation;
      }
      if (message.isGiftDanmaku) {
        display.tag = '礼物弹幕';
      }
      break;
    }
  }

  if (!display.content) {
    display.content = '（无内容）';
  }

  return display;
}

function createTagElement(text) {
  const span = document.createElement('span');
  span.className = 'danmaku-item__tag';
  span.textContent = text;
  return span;
}

function createDanmakuItemElement(message) {
  const li = document.createElement('li');
  const type = typeof message.type === 'number' ? message.type : MESSAGE_TYPE_TEXT;
  li.className = `danmaku-item danmaku-item--type-${type}`;

  const meta = document.createElement('div');
  meta.className = 'danmaku-item__meta';

  const metaGroup = document.createElement('div');
  metaGroup.className = 'danmaku-item__meta-group';

  const authorSpan = document.createElement('span');
  authorSpan.className = 'danmaku-item__author';
  authorSpan.textContent = message.authorName || '匿名用户';
  metaGroup.appendChild(authorSpan);

  const display = formatDanmakuDisplay(message);
  if (display.tag) {
    metaGroup.appendChild(createTagElement(display.tag));
  }
  display.extraTags.forEach((text) => {
    metaGroup.appendChild(createTagElement(text));
  });

  meta.appendChild(metaGroup);

  const timeEl = document.createElement('time');
  const time = resolveDanmakuTime(message);
  timeEl.className = 'danmaku-item__time';
  timeEl.dateTime = time.toISOString();
  timeEl.textContent = timeFormatter.format(time);
  meta.appendChild(timeEl);

  li.appendChild(meta);

  const content = document.createElement('div');
  content.className = 'danmaku-item__content';
  content.textContent = display.content;
  li.appendChild(content);

  if (display.translation) {
    const translation = document.createElement('div');
    translation.className = 'danmaku-item__translation';
    translation.textContent = display.translation;
    li.appendChild(translation);
  }

  return li;
}

function renderDanmakuList() {
  if (!danmakuListEl) {
    return;
  }
  const shouldStickToBottom =
    danmakuListEl.scrollHeight - danmakuListEl.scrollTop - danmakuListEl.clientHeight < 16;
  danmakuListEl.innerHTML = '';
  const fragment = document.createDocumentFragment();
  danmakuMessages.forEach((message) => {
    fragment.appendChild(createDanmakuItemElement(message));
  });
  danmakuListEl.appendChild(fragment);
  if (shouldStickToBottom) {
    danmakuListEl.scrollTop = danmakuListEl.scrollHeight;
  }
}

function scheduleStateRefresh(delay = 300) {
  if (refreshTimer) {
    return;
  }
  refreshTimer = window.setTimeout(() => {
    refreshTimer = null;
    fetchState('danmaku');
  }, delay);
}

function handleDanmakuAdd(message) {
  if (!message || typeof message !== 'object') {
    return;
  }
  const id = message.id || message.messageId;
  if (!id) {
    return;
  }
  console.debug('[study-room] handleDanmakuAdd', message);
  message.id = String(id);
  message.type = typeof message.type === 'number' ? message.type : MESSAGE_TYPE_TEXT;
  if (typeof message.addTime === 'string') {
    const parsed = new Date(message.addTime);
    if (!Number.isNaN(parsed.getTime())) {
      message.addTime = parsed;
    }
  }
  danmakuMap.set(message.id, message);
  danmakuMessages.push(message);
  if (danmakuMessages.length > MAX_DANMAKU_MESSAGES) {
    const overflow = danmakuMessages.length - MAX_DANMAKU_MESSAGES;
    for (let i = 0; i < overflow; i += 1) {
      const removed = danmakuMessages.shift();
      if (removed && removed.id) {
        danmakuMap.delete(removed.id);
      }
    }
  }
  renderDanmakuList();
  scheduleStateRefresh(300);
}

function applyMessageUpdate(target, updates) {
  if (!target || !updates) {
    return;
  }
  const additions = updates.$add;
  if (additions && typeof additions === 'object') {
    Object.keys(additions).forEach((key) => {
      const current = typeof target[key] === 'number' ? target[key] : Number(target[key]) || 0;
      target[key] = current + additions[key];
    });
  }
  Object.keys(updates).forEach((key) => {
    if (key.startsWith && key.startsWith('$')) {
      return;
    }
    target[key] = updates[key];
  });
}

function handleDanmakuUpdate(payload) {
  if (!payload || typeof payload !== 'object') {
    return;
  }
  const id = payload.id;
  if (!id) {
    return;
  }
  console.debug('[study-room] handleDanmakuUpdate', payload);
  const target = danmakuMap.get(String(id));
  if (!target) {
    return;
  }
  applyMessageUpdate(target, payload.newValuesObj || {});
  renderDanmakuList();
  scheduleStateRefresh(400);
}

function handleDanmakuDelete(payload) {
  if (!payload) {
    return;
  }
  console.debug('[study-room] handleDanmakuDelete', payload);
  let ids = [];
  if (Array.isArray(payload)) {
    ids = payload;
  } else if (Array.isArray(payload.ids)) {
    ids = payload.ids;
  } else if (payload.id) {
    ids = [payload.id];
  }
  if (!ids.length) {
    return;
  }
  const idSet = new Set(ids.map((value) => String(value)));
  for (let index = danmakuMessages.length - 1; index >= 0; index -= 1) {
    const message = danmakuMessages[index];
    if (message && idSet.has(String(message.id))) {
      danmakuMessages.splice(index, 1);
    }
  }
  idSet.forEach((value) => {
    danmakuMap.delete(value);
  });
  renderDanmakuList();
  scheduleStateRefresh(400);
}

function applySnapshot(snapshot) {
  currentSnapshot = snapshot;
  ensureSeatElements(snapshot.seats);
  updateSeats(snapshot.seats);
  updateLeaderboard(snapshot.leaderboard);
  updateMessages(snapshot.systemMessages);
  updateJoinPrompt(snapshot.joinPrompt || {}, snapshot.activityConfig);
  updateDebugExamples(snapshot.joinPrompt || {});
  updateWaitlist(snapshot.waitlist);
  handleRecentEvents(snapshot.recentEvents);
}

function buildStateUrl() {
  const url = new URL('/api/study_room/state', window.location.origin);
  url.searchParams.set('roomKeyType', String(roomInfo.roomKeyType ?? 1));
  url.searchParams.set('roomKeyValue', String(roomInfo.roomKeyValue));
  return url;
}

async function fetchState(reason = 'poll') {
  if (!roomInfo.roomKeyValue) {
    setConnectionState(false);
    return;
  }
  if (isFetchingState) {
    pendingFetchState = true;
    return;
  }
  isFetchingState = true;

  try {
    const stateUrl = buildStateUrl();
    console.debug('[study-room] fetchState start', { reason, stateUrl: stateUrl.toString() });
    const res = await fetch(stateUrl, { cache: 'no-store' });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const snapshot = await res.json();
    console.debug('[study-room] fetchState success', snapshot);
    applySnapshot(snapshot);
    setConnectionState(true);
  } catch (error) {
    console.error('无法获取学习房间状态', error);
    setConnectionState(false);
  } finally {
    isFetchingState = false;
    if (pendingFetchState) {
      pendingFetchState = false;
      fetchState('pending');
    }
  }
}

function resolveRoomInfoFallback() {
  const parseFromUrl = (urlString) => {
    try {
      const url = new URL(urlString, window.location.origin);
      const info = {};
      if (url.searchParams.has('roomKeyValue')) {
        info.roomKeyValue = url.searchParams.get('roomKeyValue');
      }
      if (!info.roomKeyValue) {
        const match = url.pathname.match(/\/room\/([^/]+)/);
        if (match && match[1]) {
          info.roomKeyValue = decodeURIComponent(match[1]);
        }
      }
      if (url.searchParams.has('roomKeyType')) {
        const parsedType = Number(url.searchParams.get('roomKeyType'));
        if (!Number.isNaN(parsedType)) {
          info.roomKeyType = parsedType;
        }
      }
      return info;
    } catch (error) {
      return {};
    }
  };

  const candidateUrls = new Set();
  candidateUrls.add(window.location.href);
  if (document.referrer) {
    candidateUrls.add(document.referrer);
  }
  try {
    if (window.parent && window.parent !== window) {
      candidateUrls.add(window.parent.location.href);
    }
  } catch (error) {
    console.debug('无法读取父窗口 URL', error);
  }
  try {
    if (window.top && window.top !== window) {
      candidateUrls.add(window.top.location.href);
    }
  } catch (error) {
    console.debug('无法读取顶层窗口 URL', error);
  }

  let discoveredType = null;
  for (const urlString of candidateUrls) {
    const info = parseFromUrl(urlString);
    if (!roomInfo.roomKeyValue && info.roomKeyValue) {
      roomInfo.roomKeyValue = info.roomKeyValue;
    }
    if (discoveredType === null && typeof info.roomKeyType === 'number') {
      discoveredType = info.roomKeyType;
    }
  }

  if (typeof discoveredType === 'number') {
    roomInfo.roomKeyType = discoveredType;
  }

  if (!roomInfo.roomKeyValue) {
    console.warn('未能从 URL 推断出房间信息', {
      locationHref: window.location.href,
      documentReferrer: document.referrer,
      parentAccessible: candidateUrls.size,
    });
  }
}

async function initBlcSdk() {
  if (!window.blcsdk || typeof window.blcsdk.init !== 'function') {
    console.warn('blcsdk 未加载，跳过直播姬桥接');
    return null;
  }

  try {
    const initResult = await window.blcsdk.init({ noMsgDelay: true, noCssInjection: true });
    blcInitData = initResult || null;
    console.debug('[study-room] blcsdk.init result', initResult);

    window.blcsdk.setMsgHandler({
      addMsg(message) {
        console.debug('[study-room] blcsdk addMsg', message);
        handleDanmakuAdd(message);
        scheduleStateRefresh(200);
      },
      updateMsg(id, newValuesObj) {
        console.debug('[study-room] blcsdk updateMsg', { id, newValuesObj });
        handleDanmakuUpdate({ id, newValuesObj });
        scheduleStateRefresh(300);
      },
      delMsgs(ids) {
        console.debug('[study-room] blcsdk delMsgs', ids);
        handleDanmakuDelete(ids);
        scheduleStateRefresh(300);
      },
    });

    applySdkConfig(initResult);
    return initResult;
  } catch (error) {
    console.warn('blcsdk 初始化失败', error);
    return null;
  }
}

function applySdkConfig(initResult) {
  if (!initResult || typeof initResult !== 'object') {
    return;
  }
  console.debug('[study-room] applySdkConfig', initResult);

  if (initResult.roomInfo) {
    const type = Number(initResult.roomInfo.roomKeyType ?? roomInfo.roomKeyType ?? 1);
    const value = initResult.roomInfo.roomKeyValue ?? roomInfo.roomKeyValue ?? null;
    roomInfo = {
      roomKeyType: Number.isNaN(type) ? 1 : type,
      roomKeyValue: value,
    };
  }

  if (initResult.config && debugPanel) {
    const raw = initResult.config.showDebugMessages;
    const shouldShow = !(raw === false || raw === 'false');
    debugPanel.style.display = shouldShow ? '' : 'none';
  }
}

async function initialize() {
  const initResult = await initBlcSdk();
  if (!initResult) {
    console.warn('未通过 blcsdk 获取房间信息，将尝试使用 URL 兜底参数');
  }
  resolveRoomInfoFallback();
  console.debug('[study-room] resolved roomInfo', roomInfo);

  if (!roomInfo.roomKeyValue) {
    setConnectionState(false);
    console.warn('未能获取房间信息，请检查配置');
    return;
  }

  await fetchState('initial');
  pollTimer = window.setInterval(fetchState, POLL_INTERVAL_MS);
}

if (debugForm) {
  debugForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(debugForm);
    if (!roomInfo.roomKeyValue) {
      alert('当前房间信息不可用，无法发送模拟弹幕');
      return;
    }

    try {
      const payload = {
        user: formData.get('user'),
        text: formData.get('text'),
        roomKeyType: roomInfo.roomKeyType ?? 1,
        roomKeyValue: roomInfo.roomKeyValue,
      };
      const res = await fetch('/api/study_room/mock_message', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok && res.status !== 204) {
        throw new Error(`HTTP ${res.status}`);
      }
      debugForm.reset();
      await fetchState();
    } catch (error) {
      alert(error.message || '发送失败');
    }
  });
}

window.addEventListener('beforeunload', () => {
  if (pollTimer) {
    window.clearInterval(pollTimer);
  }
});

renderDanmakuList();
initialize();
