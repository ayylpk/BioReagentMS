package com.bioreagent.aspect;

import com.bioreagent.annotation.RequireRole;
import com.bioreagent.context.BaseContext;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.springframework.stereotype.Component;

import java.util.Arrays;

/**
 * 权限校验切面 —— 拦截 @RequireRole，比对当前用户角色
 */
@Aspect
@Component
public class RoleAspect {

    @Around("@annotation(requireRole)")
    public Object check(ProceedingJoinPoint pjp, RequireRole requireRole) throws Throwable {
        Integer currentRole = BaseContext.getCurrentRole();
        if (currentRole == null) {
            throw new RuntimeException("未登录，无法访问");
        }
        int[] allowed = requireRole.value();
        for (int r : allowed) {
            if (r == currentRole) {
                return pjp.proceed(); // 命中，放行
            }
        }
        throw new RuntimeException("无权限，当前角色: " + currentRole
                + "，允许的角色: " + Arrays.toString(allowed));
    }
}
