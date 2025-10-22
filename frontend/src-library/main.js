import Vue from 'vue'
import App from './App.vue'

import './styles/pixel.css'

Vue.config.productionTip = false

async function bootstrap() {
  const sdk = window.blcsdk || null
  let initialRoomKeyType = 1
  let initialRoomKeyValue = null

  if (sdk && typeof sdk.init === 'function') {
    try {
      await sdk.init()
      const roomInfo = await sdk.getRoomInfo()
      if (roomInfo) {
        initialRoomKeyType = roomInfo.type ?? roomInfo.roomKeyType ?? initialRoomKeyType
        initialRoomKeyValue = roomInfo.value ?? roomInfo.roomKeyValue ?? initialRoomKeyValue
      }
    } catch (error) {
      console.debug('Failed to initialise blcsdk', error)
    }
  }

  new Vue({
    render: h => h(App, {
      props: {
        sdk,
        initialRoomKeyType,
        initialRoomKeyValue,
      },
    }),
  }).$mount('#app')
}

bootstrap()
