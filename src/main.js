import { createApp } from 'vue'
import App from './App.vue'
import './styles.css'
import { bootstrap, toast } from './lib/store'

const app = createApp(App)
app.mount('#app')

bootstrap().catch((err) => {
  toast({
    title: '无法连接协议内核',
    description: `${err.message} · 请先运行 npm run dev:server`,
    tone: 'danger',
    timeout: 8000
  })
})
