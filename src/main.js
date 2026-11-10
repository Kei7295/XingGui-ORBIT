import { createApp } from 'vue'
import App from './App.vue'
import './styles.css'
import { bootstrap, toast } from './lib/store'

const boot = window.__orbitBoot || { set() {}, done() {} }

const app = createApp(App)
app.mount('#app')

boot.set(45, '正在连接协议内核')

bootstrap()
  .then(() => {
    boot.set(92, '正在同步实时事件流')
    requestAnimationFrame(() => boot.done())
  })
  .catch((err) => {
    boot.set(100, '连接失败')
    setTimeout(() => boot.done(), 600)
    toast({
      title: '无法连接协议内核',
      description: `${err.message} · 请先运行 npm run dev:server`,
      tone: 'danger',
      timeout: 8000
    })
  })
