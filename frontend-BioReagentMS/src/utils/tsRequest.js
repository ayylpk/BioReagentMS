// tsAgent(:8123) 的裸 axios 封装 —— 与 utils/request.js 的区别（两处刻意不同，别抄错）：
//   ① 走 :8123 不走 /api（Java 后端），所以不套 {code,msg,data} 包装，直接返回 res.data
//   ② 必须挂 `token` 头：人审端点在后端验 JWT + 查 RBAC 权限码（见 tsAgent/src/service/auth.ts）
//      没带 token → 401；带了但没权限 → 403；服务端没配 JWT_SECRET_KEY → 503（都会给人话，不静默）
import axios from 'axios'
import { ElMessage } from 'element-plus'

const tsRequest = axios.create({ timeout: 30000 })

tsRequest.interceptors.request.use((cfg) => {
  const token = localStorage.getItem('token')
  if (token && token !== 'undefined' && token !== 'null') cfg.headers.token = token
  return cfg
})

tsRequest.interceptors.response.use(
  (res) => res.data,
  (err) => {
    const data = err.response?.data || {}
    const status = err.response?.status
    // 后端每条失败都给了人话（error/hint），原样透出 —— 别再包一层"请求失败"把线索盖掉
    const msg = data.error || (status ? `请求失败 ${status}` : '网络异常（tsAgent :8123 起了吗？）')
    ElMessage.error(data.hint ? `${msg}｜${data.hint}` : msg)
    return Promise.reject(Object.assign(err, { friendly: msg }))
  },
)

export default tsRequest
