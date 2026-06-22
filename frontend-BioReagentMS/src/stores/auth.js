import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import request from '@/utils/request'

// 安全读取 token，过滤掉意外写入的 "undefined" / "null"
function getStoredToken() {
  const raw = localStorage.getItem('token')
  if (!raw || raw === 'undefined' || raw === 'null') return ''
  return raw
}

// 从 localStorage 恢复用户信息
function getStoredUserInfo() {
  try {
    const raw = localStorage.getItem('userInfo')
    if (!raw || raw === 'undefined' || raw === 'null') return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export const useAuthStore = defineStore('auth', () => {
  const token = ref(getStoredToken())
  const userInfo = ref(getStoredUserInfo())

  const isLoggedIn = computed(() => !!token.value)
  const username = computed(() => userInfo.value?.username || '')
  const realName = computed(() => userInfo.value?.realName || userInfo.value?.username || '')
  const userRole = computed(() => userInfo.value?.role ?? -1)

  // 登录
  async function login(loginForm) {
    const res = await request.post('/login', loginForm)
    const data = res.data

    // 后端 LoginVO: { accessToken, userId, role, username }
    const rawToken = data?.accessToken || ''
    token.value = rawToken
    userInfo.value = data

    if (rawToken) {
      localStorage.setItem('token', rawToken)
      // 持久化 userInfo，防止刷新后角色丢失导致菜单/权限异常
      localStorage.setItem('userInfo', JSON.stringify(data))
    }
    return res
  }

  // 退出
  function logout() {
    token.value = ''
    userInfo.value = null
    localStorage.removeItem('token')
    localStorage.removeItem('userInfo')
  }

  // 获取当前用户信息（token 有效时刷新）
  async function fetchUserInfo() {
    const res = await request.get('/users/current')
    userInfo.value = res.data
  }

  return { token, userInfo, isLoggedIn, username, realName, userRole, login, logout, fetchUserInfo }
})
