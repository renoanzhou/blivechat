<template>
  <section class="seat-board">
    <header class="seat-board__header">
      <h2 class="seat-board__title">座位表</h2>
      <span class="seat-board__meta">
        <span class="seat-board__dot" :class="{ 'is-online': isOnline }"></span>
        {{ occupantList.length }} / {{ totalSeats }}
      </span>
    </header>

    <ol class="seat-board__list" v-if="occupantList.length">
      <li v-for="(entry, index) in occupantList" :key="entry.userId || entry.name" class="seat-board__item">
        <span class="seat-board__rank">{{ index + 1 }}</span>
        <div class="seat-board__info">
          <span class="seat-board__name">{{ entry.name }}</span>
          <span class="seat-board__seat">{{ entry.seatLabel }}</span>
        </div>
        <span class="seat-board__time">{{ formatDuration(entry.totalStudyMs) }}</span>
      </li>
    </ol>

    <div class="seat-board__empty" v-else>
      <span>还没有人入座</span>
    </div>
  </section>
</template>

<script>
export default {
  name: 'SeatBoard',
  props: {
    seats: {
      type: Array,
      default: () => [],
    },
    isOnline: {
      type: Boolean,
      default: true,
    },
  },
  computed: {
    occupantList() {
      if (!Array.isArray(this.seats)) {
        return []
      }
      return this.seats
        .map(seat => {
          if (!seat.occupant) {
            return null
          }
          return {
            ...seat.occupant,
            seatLabel: seat.label,
          }
        })
        .filter(Boolean)
        .sort((a, b) => (b.totalStudyMs || 0) - (a.totalStudyMs || 0))
    },
    totalSeats() {
      return Array.isArray(this.seats) ? this.seats.length : 0
    },
  },
  methods: {
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
  },
}
</script>
