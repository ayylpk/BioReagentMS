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

// 401 只处理一次：像首页那种「一个页面并发好几个请求」的场景，token 过期时
// 旧写法是每个失败请求各弹一条提示、各改写一次 location —— 用户连吃几条错误、还触发多次跳转。
let redirecting = false

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
        // token 和用户信息一起清：只清 token 的话，store 里还留着上一个账号的 role/姓名，
        // 刷新后角色判断会拿旧值（菜单、按钮显隐跟着错）
        localStorage.removeItem('token')
        localStorage.removeItem('userInfo')
        if (!redirecting) {
          redirecting = true
          ElMessage.error('登录已过期，请重新登录')
          // 跳转登录页（避免在登录页重复跳转）
          if (window.location.pathname !== '/login') {
            window.location.href = '/login'
          }
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
