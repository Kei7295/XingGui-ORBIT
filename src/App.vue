<script setup>
import { computed } from 'vue'
import AppSidebar from './components/AppSidebar.vue'
import AppTopbar from './components/AppTopbar.vue'
import ToastHost from './components/ToastHost.vue'
import CommandPalette from './components/CommandPalette.vue'

import DashboardPage from './pages/DashboardPage.vue'
import AccountsPage from './pages/AccountsPage.vue'
import MessagesPage from './pages/MessagesPage.vue'
import ContactsPage from './pages/ContactsPage.vue'
import RiskPage from './pages/RiskPage.vue'
import ConnectionPage from './pages/ConnectionPage.vue'
import ApiPlaygroundPage from './pages/ApiPlaygroundPage.vue'
import LogsPage from './pages/LogsPage.vue'
import SettingsPage from './pages/SettingsPage.vue'

import { currentPath } from './lib/router'
import { state } from './lib/store'

const pages = {
  '/': DashboardPage,
  '/accounts': AccountsPage,
  '/messages': MessagesPage,
  '/contacts': ContactsPage,
  '/risk': RiskPage,
  '/connection': ConnectionPage,
  '/api': ApiPlaygroundPage,
  '/logs': LogsPage,
  '/settings': SettingsPage
}

const page = computed(() => pages[currentPath.value] || DashboardPage)
</script>

<template>
  <div class="min-h-screen bg-background text-foreground">
    <AppSidebar />
    <div class="lg:pl-[248px]">
      <AppTopbar />
      <main class="mx-auto w-full max-w-[1440px] px-4 py-5 sm:px-6 sm:py-6 lg:px-8">
        <component :is="page" :key="currentPath" class="page-enter" />
      </main>
      <footer
        class="mx-auto flex w-full max-w-[1440px] flex-col gap-2 border-t border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8"
      >
        <p class="mono text-[9.5px] uppercase tracking-[0.16em] text-subtle-foreground">
          ORBIT CORE · ONEBOT 11 · NODE {{ '24' }} · {{ state.accounts.length }} ACCOUNTS
        </p>
        <p class="flex items-center gap-2 font-mono text-[9.5px] uppercase tracking-[0.16em] text-subtle-foreground">
          <span class="dot" :class="state.risk.safeMode ? 'dot-warn' : 'dot-live'" />
          {{ state.risk.safeMode ? 'SAFE MODE' : 'RISK GUARD ACTIVE' }}
        </p>
      </footer>
    </div>
    <ToastHost />
    <CommandPalette />
  </div>
</template>
