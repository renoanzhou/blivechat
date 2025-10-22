<template>
  <aside class="debug-panel">
    <details open>
      <summary>调试面板（模拟弹幕）</summary>
      <form class="debug-panel__form" @submit.prevent="handleSubmit">
        <label>
          昵称
          <input v-model="user" type="text" placeholder="小明" required />
        </label>
        <label>
          弹幕内容
          <input v-model="text" type="text" placeholder="/加入图书馆" required />
        </label>
        <button type="submit" :disabled="submitting">
          {{ submitting ? "发送中..." : "发送模拟弹幕" }}
        </button>
        <p class="debug-panel__hint">支持命令示例：/加入图书馆、/离开座位</p>
      </form>
    </details>
  </aside>
</template>

<script>
export default {
  name: 'DebugPanel',
  props: {
    roomInfo: {
      type: Object,
      required: true,
    },
  },
  data() {
    return {
      user: '',
      text: '',
      submitting: false,
    }
  },
  methods: {
    async handleSubmit() {
      if (!this.roomInfo || !this.roomInfo.roomKeyValue) {
        window.alert('缺少 roomKeyValue，无法发送模拟弹幕')
        return
      }
      this.submitting = true
      try {
        const payload = {
          user: this.user.trim(),
          text: this.text.trim(),
          roomKeyType: this.roomInfo.roomKeyType,
          roomKeyValue: this.roomInfo.roomKeyValue,
        }
        const res = await fetch('/api/study_room/mock_message', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`)
        }
        this.text = ''
      } catch (error) {
        console.error('Failed to send mock message', error)
        window.alert('发送模拟弹幕失败，请查看控制台日志')
      } finally {
        this.submitting = false
      }
    },
  },
}
</script>

<style scoped>
.debug-panel {
  margin-top: 24px;
  background: rgba(15, 23, 42, 0.88);
  border: 2px solid rgba(56, 189, 248, 0.35);
  border-radius: 10px;
  padding: 12px 16px;
}

.debug-panel__form {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 12px;
}

.debug-panel__form label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  color: rgba(226, 232, 240, 0.85);
}

.debug-panel__form input {
  padding: 8px 10px;
  border-radius: 6px;
  border: 1px solid rgba(148, 163, 184, 0.35);
  background: rgba(10, 15, 30, 0.9);
  color: #f8fafc;
}

.debug-panel__form button {
  padding: 10px 12px;
  border: none;
  border-radius: 6px;
  background: linear-gradient(135deg, rgba(56, 189, 248, 0.8), rgba(59, 130, 246, 0.8));
  color: #0f172a;
  font-weight: 600;
  cursor: pointer;
}

.debug-panel__form button:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

.debug-panel__hint {
  margin: 0;
  font-size: 12px;
  color: rgba(148, 163, 184, 0.8);
}
</style>
