<template>
  <div class="library-shell">
    <div class="library-shell__inner" :class="{ 'is-offline': !isOnline }">
      <div class="library-shell__background" :style="backgroundStyle"></div>
      <div class="library-shell__overlay">
        <header class="join-banner" v-if="joinBannerVisible">
          <div class="join-banner__left">
            <span class="join-banner__sparkle">✦</span>
            <span class="join-banner__label">空位</span>
            <span class="join-banner__count">{{ availableSeatCount }}</span>
          </div>
          <div class="join-banner__command">
            <span class="join-banner__hint">发送</span>
            <code class="join-banner__code">{{ joinPrompt.primaryCommand }}</code>
            <span class="join-banner__hint">即可入座</span>
          </div>
          <div class="join-banner__activity" v-if="activityHint">
            {{ activityHint }}
          </div>
        </header>

        <div class="library-shell__grid" :style="gridInlineStyle">
          <div
            v-for="seat in seats"
            :key="seat.id"
            class="seat-card"
            :class="seatStatusClass(seat)"
            :style="seatPositionStyle(seat)"
          >
            <div class="seat-card__label">{{ seat.label }}</div>
            <div class="seat-card__body">
              <div class="seat-card__name">{{ seat.occupant ? seat.occupant.name : '空位' }}</div>
              <div class="seat-card__status">
                {{ seatStatusText(seat) }}
              </div>
            </div>
          </div>
        </div>

        <aside class="waitlist-panel" v-if="waitlist && waitlist.length">
          <div class="waitlist-panel__title">候补队列</div>
          <ol class="waitlist-panel__list">
            <li v-for="entry in waitlist" :key="entry.name + entry.requestedAt" class="waitlist-panel__item">
              <span class="waitlist-panel__pos">{{ entry.position }}</span>
              <span class="waitlist-panel__name">{{ entry.name }}</span>
              <span class="waitlist-panel__time">{{ formatClock(entry.requestedAt) }}</span>
            </li>
          </ol>
        </aside>

        <div class="library-shell__offline" v-if="!isOnline">
          <span>连接中断</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'LibraryView',
  props: {
    seats: {
      type: Array,
      default: () => [],
    },
    joinPrompt: {
      type: Object,
      default: () => ({}),
    },
    waitlist: {
      type: Array,
      default: () => [],
    },
    backgroundUrl: {
      type: String,
      default: '',
    },
    isOnline: {
      type: Boolean,
      default: true,
    },
    activityHint: {
      type: String,
      default: '',
    },
  },
  computed: {
    joinBannerVisible() {
      return Boolean(this.joinPrompt && this.joinPrompt.primaryCommand)
    },
    backgroundStyle() {
      const styles = {
        imageRendering: 'pixelated',
      }
      if (this.backgroundUrl) {
        styles.backgroundImage = `url(${this.backgroundUrl})`
      }
      return styles
    },
    gridInlineStyle() {
      if (!this.seats.length) {
        return {}
      }
      const maxRow = Math.max(...this.seats.map(item => item.row)) + 1
      const maxCol = Math.max(...this.seats.map(item => item.col)) + 1
      return {
        '--grid-rows': maxRow,
        '--grid-cols': maxCol,
      }
    },
    availableSeatCount() {
      if (!this.seats.length) {
        return this.joinPrompt && typeof this.joinPrompt.availableSeatCount === 'number'
          ? this.joinPrompt.availableSeatCount
          : 0
      }
      return this.seats.filter(seat => !seat.occupant).length
    },
  },
  methods: {
    seatPositionStyle(seat) {
      return {
        gridRow: seat.row + 1,
        gridColumn: seat.col + 1,
      }
    },
    seatStatusClass(seat) {
      if (!seat.occupant) {
        return ['is-empty']
      }
      const status = seat.occupant.status || 'idle'
      return [`status-${status}`]
    },
    seatStatusText(seat) {
      if (!seat.occupant) {
        return '等待加入'
      }
      const statusMap = {
        study: '学习中',
        rest: '休息中',
        away: '暂离',
        idle: '准备中',
      }
      const status = statusMap[seat.occupant.status] || '在线'
      const duration = this.formatDuration(seat.occupant.totalStudyMs)
      return `${status} · ${duration}`
    },
    formatDuration(ms) {
      const totalSeconds = Math.max(0, Math.floor(ms / 1000))
      const hours = Math.floor(totalSeconds / 3600)
      const minutes = Math.floor((totalSeconds % 3600) / 60)
      const seconds = totalSeconds % 60
      if (hours > 0) {
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds
          .toString()
          .padStart(2, '0')}`
      }
      return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
    },
    formatClock(timestamp) {
      if (!timestamp) {
        return '--:--'
      }
      const date = new Date(timestamp)
      return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`
    },
  },
}
</script>
