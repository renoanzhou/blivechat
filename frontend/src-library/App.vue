<template>
  <div class="pixel-app">
    <main class="pixel-layout">
      <LibraryView
        class="pixel-layout__left"
        :seats="seats"
        :join-prompt="joinPrompt"
        :waitlist="waitlist"
        :is-online="isOnline"
        :connection-state="connectionState"
        :background-url="backgroundUrl"
        :activity-hint="activityHint"
      />
      <div class="pixel-layout__right">
        <SeatBoard :seats="seats" :is-online="isOnline" />
        <DebugPanel v-if="debugEnabled" :room-info="roomInfo" />
      </div>
    </main>
    <ToastStack :toasts="toasts" />
  </div>
</template>

<script>
import LibraryView from './components/LibraryView.vue'
import SeatBoard from './components/SeatBoard.vue'
import ToastStack from './components/ToastStack.vue'
import DebugPanel from './components/DebugPanel.vue'

const POLL_INTERVAL_MS = 5000
const TOAST_TIMEOUT_MS = 4500
const REFRESH_DEBOUNCE_MS = 400

export default {
  name: 'LibraryApp',
  components: {
    LibraryView,
    SeatBoard,
    ToastStack,
    DebugPanel,
  },
  props: {
    sdk: {
      type: Object,
      default: null,
    },
    initialRoomKeyType: {
      type: Number,
      default: 1,
    },
    initialRoomKeyValue: {
      type: String,
      default: null,
    },
  },
  data() {
    return {
      roomInfo: {
        roomKeyType: this.initialRoomKeyType ?? 1,
        roomKeyValue: this.initialRoomKeyValue ?? null,
      },
      state: null,
      connectionState: this.initialRoomKeyValue ? 'loading' : 'waiting',
      isFetching: false,
      pendingFetch: false,
      pollTimer: null,
      refreshTimer: null,
      toasts: [],
      backgroundUrl: this.resolveBackgroundUrl(),
      debugEnabled: this.resolveDebugEnabled(),
      seenEventKeys: new Set(),
    }
  },
  computed: {
    isOnline() {
      return this.connectionState === 'online'
    },
    seats() {
      return this.state && Array.isArray(this.state.seats) ? this.state.seats : []
    },
    joinPrompt() {
      return this.state && this.state.joinPrompt ? this.state.joinPrompt : {}
    },
    waitlist() {
      return this.state && Array.isArray(this.state.waitlist) ? this.state.waitlist : []
    },
    activityHint() {
      if (!this.state || !this.state.activityConfig) {
        return ''
      }
      const windowMs = this.state.activityConfig.activityWindowMs || 0
      const minMessages = this.state.activityConfig.activityMinMessages || 1
      const minutes = Math.max(1, Math.round(windowMs / 60000))
      return `保持座位：${minutes} 分钟内发送至少 ${minMessages} 条弹幕`
    },
    hasRoomKey() {
      return Boolean(this.roomInfo.roomKeyValue)
    },
  },
  watch: {
    initialRoomKeyType(newVal) {
      this.roomInfo.roomKeyType = newVal ?? this.roomInfo.roomKeyType
    },
    initialRoomKeyValue(newVal) {
      if (newVal && newVal !== this.roomInfo.roomKeyValue) {
        this.roomInfo.roomKeyValue = newVal
        this.onRoomKeyReady()
      }
    },
  },
  created() {
    this.bootstrapRoomInfo()
    this.setupSdkHandler()
    if (this.hasRoomKey) {
      this.onRoomKeyReady()
    }
    this.pollTimer = window.setInterval(() => {
      this.fetchState()
    }, POLL_INTERVAL_MS)
  },
  beforeDestroy() {
    if (this.pollTimer) {
      window.clearInterval(this.pollTimer)
      this.pollTimer = null
    }
    if (this.refreshTimer) {
      window.clearTimeout(this.refreshTimer)
      this.refreshTimer = null
    }
  },
  methods: {
    setupSdkHandler() {
      if (!this.sdk || !this.sdk.MsgHandler) {
        return
      }
      const vm = this
      class PixelMsgHandler extends vm.sdk.MsgHandler {
        addMsg(msg) {
          vm.onSdkEvent('danmaku', msg)
        }

        addSuperChat(msg) {
          vm.onSdkEvent('superChat', msg)
        }

        addGift(msg) {
          vm.onSdkEvent('gift', msg)
        }

        addGuard(msg) {
          vm.onSdkEvent('guard', msg)
        }

        heartbeat() {
          vm.scheduleRefresh(1000)
        }
      }
      try {
        this.sdk.setMsgHandler(new PixelMsgHandler())
      } catch (error) {
        console.debug('Failed to register SDK handler', error)
      }
    },
    onSdkEvent(type, payload) {
      if (this.debugEnabled) {
        console.debug('[blcsdk]', type, payload)
      }
      this.scheduleRefresh()
    },
    onRoomKeyReady() {
      this.connectionState = 'loading'
      this.fetchState()
    },
    scheduleRefresh(delay = REFRESH_DEBOUNCE_MS) {
      if (this.refreshTimer) {
        window.clearTimeout(this.refreshTimer)
        this.refreshTimer = null
      }
      this.refreshTimer = window.setTimeout(() => {
        this.refreshTimer = null
        this.fetchState()
      }, delay)
    },
    async fetchState() {
      if (!this.roomInfo.roomKeyValue) {
        this.connectionState = 'missing-room'
        this.state = null
        return
      }
      if (this.isFetching) {
        this.pendingFetch = true
        return
      }
      this.isFetching = true
      try {
        const url = this.buildStateUrl()
        const res = await fetch(url.toString(), { cache: 'no-store' })
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`)
        }
        const snapshot = await res.json()
        this.handleSnapshot(snapshot)
        this.connectionState = 'online'
      } catch (error) {
        console.error('Failed to fetch study room state', error)
        this.connectionState = 'offline'
        this.state = null
      } finally {
        this.isFetching = false
        if (this.pendingFetch) {
          this.pendingFetch = false
          this.fetchState()
        }
      }
    },
    handleSnapshot(snapshot) {
      this.state = snapshot
      this.handleEvents(snapshot && snapshot.recentEvents ? snapshot.recentEvents : [])
    },
    handleEvents(events) {
      if (!Array.isArray(events)) {
        return
      }
      events.forEach(event => {
        const key = this.buildEventKey(event)
        if (!key || this.seenEventKeys.has(key)) {
          return
        }
        this.seenEventKeys.add(key)
        const toast = this.buildToastPayload(event)
        if (toast) {
          this.pushToast(toast)
        }
      })
      if (this.seenEventKeys.size > 200) {
        const recent = Array.from(this.seenEventKeys).slice(-200)
        this.seenEventKeys = new Set(recent)
      }
    },
    buildEventKey(event) {
      if (!event) {
        return null
      }
      return `${event.type}:${event.userId || event.username || 'anon'}:${event.timestamp}`
    },
    buildToastPayload(event) {
      if (!event) {
        return null
      }
      const name = event.username || '观众'
      const seat = event.seatLabel ? ` ${event.seatLabel}` : ''
      switch (event.type) {
      case 'join':
        return { message: `${name} 成功入座${seat}`, variant: 'success' }
      case 'waitlist':
        return { message: `${name} 加入候补队列`, variant: 'info' }
      case 'waitlist_promoted':
        return { message: `${name} 从候补进入${seat}`, variant: 'success' }
      case 'leave':
        return { message: `${name} 离开了座位`, variant: 'neutral' }
      case 'auto_leave':
        return { message: `${name} 因长时间未互动被移出`, variant: 'warning' }
      default:
        return null
      }
    },
    pushToast(toast) {
      const payload = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        ...toast,
      }
      this.toasts.push(payload)
      window.setTimeout(() => {
        this.removeToast(payload.id)
      }, TOAST_TIMEOUT_MS)
      if (this.toasts.length > 5) {
        this.toasts.shift()
      }
    },
    removeToast(id) {
      const index = this.toasts.findIndex(item => item.id === id)
      if (index !== -1) {
        this.toasts.splice(index, 1)
      }
    },
    buildStateUrl() {
      const url = new URL('/api/study_room/state', window.location.origin)
      url.searchParams.set('roomKeyType', String(this.roomInfo.roomKeyType ?? 1))
      url.searchParams.set('roomKeyValue', String(this.roomInfo.roomKeyValue ?? ''))
      return url
    },
    bootstrapRoomInfo() {
      if (this.roomInfo.roomKeyValue) {
        return
      }
      const tryApplyQuery = search => {
        if (!search) {
          return
        }
        const params = new URLSearchParams(search)
        if (params.has('roomKeyValue')) {
          this.roomInfo.roomKeyValue = this.roomInfo.roomKeyValue || params.get('roomKeyValue')
        }
        if (params.has('roomKeyType')) {
          const parsedType = parseInt(params.get('roomKeyType'), 10)
          if (!Number.isNaN(parsedType)) {
            this.roomInfo.roomKeyType = parsedType
          }
        }
      }
      const tryApplyPath = locationLike => {
        if (!locationLike || this.roomInfo.roomKeyValue) {
          return
        }
        let pathname = ''
        try {
          if (typeof locationLike === 'string') {
            pathname = new URL(locationLike).pathname
          } else if (locationLike && typeof locationLike.pathname === 'string') {
            pathname = locationLike.pathname
          }
        } catch (error) {
          return
        }
        const match = pathname && pathname.match(/\/room\/([^/?#]+)/i)
        if (match && match[1]) {
          this.roomInfo.roomKeyValue = match[1]
        }
      }
      try {
        tryApplyQuery(window.location.search)
        tryApplyPath(window.location)
        if (!this.roomInfo.roomKeyValue && document.referrer) {
          const refUrl = new URL(document.referrer)
          tryApplyQuery(refUrl.search)
          tryApplyPath(refUrl)
        }
      } catch (error) {
        console.debug('bootstrapRoomInfo failed', error)
      }
    },
    resolveBackgroundUrl() {
      try {
        const params = new URLSearchParams(window.location.search)
        return params.get('background') || params.get('bg') || ''
      } catch (error) {
        return ''
      }
    },
    resolveDebugEnabled() {
      const matcher = value => {
        if (value == null) {
          return false
        }
        if (value === '') {
          return true
        }
        return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase())
      }
      try {
        const params = new URLSearchParams(window.location.search)
        if (matcher(params.get('showDebugMessages')) || matcher(params.get('debug'))) {
          return true
        }
        if (window.parent && window.parent !== window) {
          try {
            const parentParams = new URLSearchParams(window.parent.location.search)
            if (matcher(parentParams.get('showDebugMessages')) || matcher(parentParams.get('debug'))) {
              return true
            }
          } catch (error) {
            console.debug('Parent debug lookup blocked', error)
          }
        }
      } catch (error) {
        console.debug('Failed to resolve debug flag', error)
      }
      return false
    },
  },
}
</script>
