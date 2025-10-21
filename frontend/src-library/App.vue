<template>
  <div class="pixel-app">
    <main class="pixel-layout">
      <LibraryView
        class="pixel-layout__left"
        :seats="seats"
        :join-prompt="joinPrompt"
        :waitlist="waitlist"
        :is-online="isOnline"
        :background-url="backgroundUrl"
        :activity-hint="activityHint"
      />
      <SeatBoard
        class="pixel-layout__right"
        :seats="seats"
        :is-online="isOnline"
      />
    </main>
    <ToastStack :toasts="toasts" />
  </div>
</template>

<script>
import LibraryView from './components/LibraryView.vue'
import SeatBoard from './components/SeatBoard.vue'
import ToastStack from './components/ToastStack.vue'

const POLL_INTERVAL_MS = 5000
const TOAST_TIMEOUT_MS = 4500

export default {
  name: 'LibraryApp',
  components: {
    LibraryView,
    SeatBoard,
    ToastStack,
  },
  data() {
    return {
      state: null,
      isOnline: true,
      isFetching: false,
      pendingFetch: false,
      pollTimer: null,
      roomInfo: {
        roomKeyType: 1,
        roomKeyValue: null,
      },
      toasts: [],
      backgroundUrl: this.resolveBackgroundUrl(),
      seenEventKeys: new Set(),
    }
  },
  computed: {
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
  },
  created() {
    this.roomInfo = this.resolveRoomInfo()
    this.fetchState()
    this.pollTimer = window.setInterval(() => {
      this.fetchState()
    }, POLL_INTERVAL_MS)
  },
  beforeDestroy() {
    if (this.pollTimer) {
      window.clearInterval(this.pollTimer)
      this.pollTimer = null
    }
  },
  methods: {
    resolveRoomInfo() {
      const info = {
        roomKeyType: 1,
        roomKeyValue: null,
      }
      try {
        const params = new URLSearchParams(window.location.search)
        if (params.has('roomKeyType')) {
          const parsedType = parseInt(params.get('roomKeyType'), 10)
          if (!Number.isNaN(parsedType)) {
            info.roomKeyType = parsedType
          }
        }
        if (params.has('roomKeyValue')) {
          info.roomKeyValue = params.get('roomKeyValue')
        }
        if (!info.roomKeyValue && window.blcInitData && window.blcInitData.room) {
          info.roomKeyType = window.blcInitData.room.type
          info.roomKeyValue = window.blcInitData.room.value
        }
      } catch (error) {
        console.warn('Failed to resolve room info', error)
      }
      return info
    },
    resolveBackgroundUrl() {
      try {
        const params = new URLSearchParams(window.location.search)
        return params.get('background') || params.get('bg') || ''
      } catch (error) {
        return ''
      }
    },
    buildStateUrl() {
      const url = new URL('/api/study_room/state', window.location.origin)
      url.searchParams.set('roomKeyType', String(this.roomInfo.roomKeyType ?? 1))
      url.searchParams.set('roomKeyValue', String(this.roomInfo.roomKeyValue ?? ''))
      return url
    },
    async fetchState() {
      if (!this.roomInfo.roomKeyValue) {
        this.isOnline = false
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
        this.isOnline = true
      } catch (error) {
        console.error('Failed to fetch study room state', error)
        this.isOnline = false
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
  },
}
</script>
