<script setup>
import { ref, computed, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { ElMessageBox } from 'element-plus'

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()

const isCollapse = ref(false)

const allMenuItems = [
  { path: '/dashboard', title: '工作台', icon: 'Monitor', roles: null },
  { path: '/reagents', title: '试剂管理', icon: 'Ticket', roles: null },
  { path: '/batches', title: '批次管理', icon: 'Collection', roles: null },
  { path: '/warehouse-in', title: '入库管理', icon: 'Box', roles: [0, 1] },
  { path: '/delivery-out', title: '出库申请', icon: 'Sell', roles: null },
  { path: '/delivery-audit', title: '出库审核', icon: 'Checked', roles: [0, 1] },
  { path: '/suppliers', title: '供应商管理', icon: 'OfficeBuilding', roles: null },
  { path: '/warnings', title: '预警管理', icon: 'Warning', roles: null },
  { path: '/reports', title: '统计报表', icon: 'DataAnalysis', roles: null },
  { path: '/operations', title: '操作日志', icon: 'Document', roles: [0] },
  { path: '/users', title: '用户管理', icon: 'User', roles: [0] },
  { path: '/chat', title: '智能助手', icon: 'ChatDotRound', roles: null },
]

const menuItems = computed(() =>
  allMenuItems.filter((item) => {
    if (!item.roles) return true
    return item.roles.includes(auth.userRole)
  }),
)

const activeMenu = computed(() => {
  // 匹配当前路由到菜单项
  const matched = route.matched
  if (matched.length > 0 && matched[0].path !== '/') {
    return matched[0].path
  }
  return route.path
})

function handleCommand(command) {
  if (command === 'logout') {
    ElMessageBox.confirm('确定要退出登录吗？', '提示', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning',
    }).then(() => {
      auth.logout()
      router.push('/login')
    }).catch(() => {})
  }
}

function goHome() {
  router.push('/dashboard')
}
</script>

<template>
  <el-container class="layout-container">
    <!-- 侧边栏 -->
    <el-aside :width="isCollapse ? '64px' : '220px'" class="aside">
      <div class="logo-area" @click="goHome">
        <img src="/logo.png" alt="logo" class="logo-img" />
        <span v-show="!isCollapse" class="logo-text">BioReagentMS</span>
      </div>

      <el-menu
        :default-active="activeMenu"
        :collapse="isCollapse"
        :collapse-transition="false"
        router
        background-color="#1d1e2c"
        text-color="#bfcbd9"
        active-text-color="#409eff"
      >
        <el-menu-item v-for="item in menuItems" :key="item.path" :index="item.path">
          <el-icon><component :is="item.icon" /></el-icon>
          <template #title>{{ item.title }}</template>
        </el-menu-item>
      </el-menu>
    </el-aside>

    <!-- 右侧主体 -->
    <el-container>
      <!-- 顶栏 -->
      <el-header class="header">
        <div class="header-left">
          <el-icon
            class="collapse-btn"
            @click="isCollapse = !isCollapse"
            :size="20"
          >
            <Fold v-if="!isCollapse" />
            <Expand v-else />
          </el-icon>
          <span class="header-title">{{ route.meta.title || 'BioReagentMS' }}</span>
        </div>

        <div class="header-right">
          <el-dropdown @command="handleCommand" trigger="click">
            <span class="user-info">
              <img src="/avatar-default.png" alt="avatar" class="avatar" />
              <span class="username">{{ auth.realName }}</span>
              <el-icon><ArrowDown /></el-icon>
            </span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="profile">个人信息</el-dropdown-item>
                <el-dropdown-item divided command="logout">退出登录</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </el-header>

      <!-- 内容区 -->
      <el-main class="main">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<style scoped>
.layout-container {
  height: 100vh;
}

.aside {
  background-color: #1d1e2c;
  overflow-x: hidden;
  transition: width 0.3s;
}

.logo-area {
  display: flex;
  align-items: center;
  height: 56px;
  padding: 0 16px;
  cursor: pointer;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.logo-img {
  height: 36px;
  width: auto;
  max-width: 100%;
  flex-shrink: 0;
}

.logo-text {
  margin-left: 10px;
  font-size: 16px;
  font-weight: 600;
  color: #fff;
  white-space: nowrap;
}

/* 侧边菜单 — 覆层 Element Plus */
.aside :deep(.el-menu) {
  border-right: none;
}

.aside :deep(.el-menu-item) {
  font-size: 14px;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 56px;
  background: #fff;
  border-bottom: 1px solid #e4e7ed;
  padding: 0 20px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.collapse-btn {
  cursor: pointer;
  color: #606266;
}

.collapse-btn:hover {
  color: #409eff;
}

.header-title {
  font-size: 15px;
  font-weight: 500;
  color: #303133;
}

.header-right {
  display: flex;
  align-items: center;
}

.user-info {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
}

.user-info:hover {
  background: #f5f7fa;
}

.avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  object-fit: cover;
}

.username {
  font-size: 14px;
  color: #303133;
}

.main {
  background: #f5f7fa;
  padding: 20px;
  overflow-y: auto;
}
</style>
