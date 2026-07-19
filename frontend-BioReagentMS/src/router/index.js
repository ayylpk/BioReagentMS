import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/login',
      name: 'Login',
      component: () => import('@/views/Login.vue'),
      meta: { title: '登录', noAuth: true },
    },
    {
      path: '/',
      component: () => import('@/layout/MainLayout.vue'),
      redirect: '/dashboard',
      children: [
        {
          path: 'dashboard',
          name: 'Dashboard',
          component: () => import('@/views/Dashboard.vue'),
          meta: { title: '工作台', icon: 'Monitor' },
        },
        {
          path: 'reagents',
          name: 'Reagents',
          component: () => import('@/views/Reagents.vue'),
          meta: { title: '试剂管理', icon: 'Ticket' },
        },
        {
          path: 'reagents/:id',
          name: 'ReagentDetail',
          component: () => import('@/views/ReagentDetail.vue'),
          meta: { title: '试剂详情', hidden: true },
        },
        {
          path: 'batches',
          name: 'Batches',
          component: () => import('@/views/Batches.vue'),
          meta: { title: '批次管理', icon: 'Collection' },
        },
        {
          path: 'warehouse-in',
          name: 'WarehouseIn',
          component: () => import('@/views/WarehouseIn.vue'),
          meta: { title: '入库管理', icon: 'Box' },
        },
        {
          path: 'delivery-out',
          name: 'DeliveryOut',
          component: () => import('@/views/DeliveryOut.vue'),
          meta: { title: '出库申请', icon: 'Sell' },
        },
        {
          path: 'delivery-audit',
          name: 'DeliveryAudit',
          component: () => import('@/views/DeliveryAudit.vue'),
          meta: { title: '出库审核', icon: 'Checked' },
        },
        {
          path: 'suppliers',
          name: 'Suppliers',
          component: () => import('@/views/Suppliers.vue'),
          meta: { title: '供应商管理', icon: 'OfficeBuilding' },
        },
        {
          path: 'users',
          name: 'Users',
          component: () => import('@/views/Users.vue'),
          meta: { title: '用户管理', icon: 'User', roles: [0] },
        },
        {
          path: 'warnings',
          name: 'Warnings',
          component: () => import('@/views/Warnings.vue'),
          meta: { title: '预警管理', icon: 'Warning' },
        },
        {
          path: 'operations',
          name: 'Operations',
          component: () => import('@/views/Operations.vue'),
          meta: { title: '操作日志', icon: 'Document' },
        },
        {
          path: 'reports',
          name: 'Reports',
          component: () => import('@/views/Reports.vue'),
          meta: { title: '统计报表', icon: 'DataAnalysis' },
        },
        {
          path: 'chat',
          name: 'Chat',
          component: () => import('@/views/Chat.vue'),
          meta: { title: '智能助手', icon: 'ChatDotRound' },
        },
        {
          path: 'web-search',
          name: 'WebSearch',
          component: () => import('@/views/WebSearch.vue'),
          meta: { title: '联网检索', icon: 'Search' },
        },
      ],
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: '/dashboard',
    },
  ],
})

// 路由守卫 — 未登录跳登录页
router.beforeEach((to) => {
  const token = localStorage.getItem('token')
  // 过滤掉 "undefined" / "null" 字符串（localStorage 可能存了异常值）
  const validToken = token && token !== 'undefined' && token !== 'null' ? token : null
  if (to.meta.noAuth) {
    return validToken ? '/dashboard' : undefined
  }
  return validToken ? undefined : '/login'
})

export default router
