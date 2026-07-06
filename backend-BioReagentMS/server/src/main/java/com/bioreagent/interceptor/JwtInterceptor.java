package com.bioreagent.interceptor;

import com.bioreagent.constant.JwtClaimsConstant;
import com.bioreagent.context.BaseContext;
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
            log.info("JWT校验: {}", token);
            Claims claims = JwtUtil.parseJWT(jwtProperties.getSecretKey(), token);
            Long userId = Long.valueOf(claims.get(JwtClaimsConstant.USER_ID).toString());
            Integer role = Integer.valueOf(claims.get(JwtClaimsConstant.ROLE).toString());
            BaseContext.setCurrentId(userId);
            BaseContext.setCurrentRole(role);
            log.info("当前用户ID: {}, role: {}", userId, role);
            return true;
        } catch (Exception ex) {
            log.warn("JWT校验失败: {}", ex.getMessage());
            response.setStatus(401);
            response.setContentType("application/json;charset=UTF-8");
            response.getWriter().write("{\"code\":0,\"msg\":\"未登录或token已过期\"}");
            return false;
        }
    }
}
