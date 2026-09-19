package com.bioreagent.interceptor;

import com.bioreagent.constant.JwtClaimsConstant;
import com.bioreagent.context.BaseContext;
import com.bioreagent.entity.User;
import com.bioreagent.mapper.UserMapper;
import com.bioreagent.properties.JwtProperties;
import com.bioreagent.utils.JwtUtil;
import io.jsonwebtoken.Claims;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerInterceptor;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

/**
 * JWT 令牌统一拦截器 —— 校验所有请求的 token
 */
@Component
@Slf4j
public class JwtInterceptor implements HandlerInterceptor {

    @Autowired
    private JwtProperties jwtProperties;

    @Autowired
    private UserMapper userMapper;

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) throws Exception {
        // 非 Controller 方法直接放行
        if (!(handler instanceof HandlerMethod)) {
            return true;
        }

        // 1. 从请求头获取 token
        String token = request.getHeader(jwtProperties.getTokenName());

        // 2. 校验 token
        try {
            // 注意：token 原文**不进日志**（日志会被收集/转发，等于把可用凭证抄了一份）
            Claims claims = JwtUtil.parseJWT(jwtProperties.getSecretKey(), token);
            Long userId = Long.valueOf(claims.get(JwtClaimsConstant.USER_ID).toString());

            // ⚠️ 角色不以 token 里的为准，改以库里的实时值为准。
            //    token 里带的 role 是"签发那一刻"的快照，而 TTL 是 2 小时 —— 这期间把某人降级、
            //    或把账号置为停用，旧 token 仍会按原角色一路畅通（停用管理形同虚设）。
            User user = userMapper.getById(userId.intValue());
            if (user == null) {
                throw new IllegalStateException("用户不存在: " + userId);
            }
            if (user.getStatus() != null && user.getStatus() != 1) {
                throw new IllegalStateException("账号已停用: " + userId);
            }

            BaseContext.setCurrentId(userId);
            BaseContext.setCurrentRole(user.getRole());
            log.info("当前用户ID: {}, role: {}", userId, user.getRole());
            return true;
        } catch (Exception ex) {
            log.warn("JWT校验失败: {}", ex.getMessage());
            response.setStatus(401);
            response.setContentType("application/json;charset=UTF-8");
            response.getWriter().write("{\"code\":0,\"msg\":\"未登录或token已过期\"}");
            return false;
        }
    }

    @Override
    public void afterCompletion(HttpServletRequest request, HttpServletResponse response,
                                Object handler, Exception ex) {
        BaseContext.removeCurrentId();
    }
}
