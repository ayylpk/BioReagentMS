<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const auth = useAuthStore()

const loginForm = ref({
  username: '',
  password: '',
})

const loading = ref(false)
const loginError = ref('')

const rules = {
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
}

async function handleLogin() {
  loginError.value = ''
  loading.value = true
  try {
    await auth.login(loginForm.value)
    router.push('/dashboard')
  } catch (err) {
    loginError.value = err.message || '登录失败，请检查用户名和密码'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login-page">
    <div class="login-card">
      <!-- 左侧品牌区 -->
      <div class="login-left">
        <div class="brand-area">
          <img src="/logo.png" alt="logo" class="brand-logo" />
          <h1 class="brand-name">BioReagentMS</h1>
          <p class="brand-desc">生物试剂管理系统</p>
        </div>
        <div class="brand-footer">
          <p>实验室试剂库存 · 出入库审批 · 全流程追踪</p>
        </div>
      </div>

      <!-- 右侧登录表单 -->
      <div class="login-right">
        <h2 class="login-title">欢迎登录</h2>

        <el-form
          :model="loginForm"
          :rules="rules"
          label-width="0"
          size="large"
          @submit.prevent="handleLogin"
        >
          <el-form-item prop="username">
            <el-input
              v-model="loginForm.username"
              placeholder="用户名"
              prefix-icon="User"
              clearable
            />
          </el-form-item>

          <el-form-item prop="password">
            <el-input
              v-model="loginForm.password"
              type="password"
              placeholder="密码"
              prefix-icon="Lock"
              show-password
              @keyup.enter="handleLogin"
            />
          </el-form-item>

          <p v-if="loginError" class="login-error">{{ loginError }}</p>

          <el-form-item>
            <el-button
              type="primary"
              :loading="loading"
              class="login-btn"
              @click="handleLogin"
            >
              {{ loading ? '登录中...' : '登 录' }}
            </el-button>
          </el-form-item>
        </el-form>
      </div>
    </div>
  </div>
</template>

<style scoped>
.login-page {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100vh;
  background: url('/login-bg.jpg') center / cover no-repeat;
  position: relative;
}

/* 背景遮罩 */
.login-page::before {
  content: '';
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
}

.login-card {
  position: relative;
  display: flex;
  width: 860px;
  height: 480px;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.3);
}

/* 左侧品牌 */
.login-left {
  flex: 1;
  background: linear-gradient(135deg, #1a3a5c 0%, #1d4d7a 100%);
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  padding: 40px;
  position: relative;
}

.brand-area {
  text-align: center;
}

.brand-logo {
  height: 128px;
  width: auto;
  max-width: 100%;
  margin-bottom: 20px;
}

.brand-name {
  font-size: 28px;
  font-weight: 700;
  color: #fff;
  letter-spacing: 2px;
}

.brand-desc {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.7);
  margin-top: 10px;
}

.brand-footer {
  position: absolute;
  bottom: 30px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.45);
}

/* 右侧表单 */
.login-right {
  width: 400px;
  background: #fff;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 50px 48px;
}

.login-title {
  font-size: 22px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 32px;
}

.login-error {
  color: #f56c6c;
  font-size: 13px;
  margin: -8px 0 8px;
}

.login-btn {
  width: 100%;
  margin-top: 8px;
}
</style>
