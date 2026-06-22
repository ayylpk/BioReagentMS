import axios from 'axios'
import { ElMessage } from 'element-plus'

const request = axios.create({
  baseURL: '/api',
  timeout: 15000,
})

// 请求拦截器 — 自动挂 token
request.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token')
    // 防止存了 "undefined" / "null" 字符串被发出去
    if (token && token !== 'undefined' && token !== 'null') {
      config.headers.token = token
    }
    return config
  },
  (error) => Promise.reject(error),
)

// 响应拦截器 — 统一处理 code / 401
request.interceptors.response.use(
  (response) => {
    const res = response.data
    // 后端统一格式 { code: 1(成功) / 0(失败), msg, data }
    if (res.code === 0) {
      ElMessage.error(res.msg || '请求失败')
      return Promise.reject(new Error(res.msg || '请求失败'))
    }
    return res
  },
  (error) => {
    if (error.response) {
      const { status } = error.response
      if (status === 401) {
        localStorage.removeItem('token')
        ElMessage.error('登录已过期，请重新登录')
        // 跳转登录页（避免在登录页重复跳转）
        if (window.location.pathname !== '/login') {
          window.location.href = '/login'
        }
      } else {
        ElMessage.error(error.response.data?.msg || `请求错误 ${status}`)
      }
    } else {
      ElMessage.error('网络异常，请检查连接')
    }
    return Promise.reject(error)
  },
)

export default request
