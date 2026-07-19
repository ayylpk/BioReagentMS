package com.bioreagent.aspect;

import com.bioreagent.annotation.RequirePermission;
import com.bioreagent.constant.RoleConstant;
import com.bioreagent.context.BaseContext;
import com.bioreagent.exception.UserNotLoginException;
import com.bioreagent.exception.BaseException;
import com.bioreagent.service.PermissionService;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.util.Set;

@Aspect
@Component
public class PermissionAspect {

    @Autowired
    private PermissionService permissionService;

    @Around("@annotation(requirePermission)")
    public Object check(ProceedingJoinPoint pjp, RequirePermission requirePermission) throws Throwable {
        Integer role = BaseContext.getCurrentRole();
        if (role == null) {
            throw new UserNotLoginException("未登录，无法访问");
        }

        if (RoleConstant.SYSTEM_ADMIN.equals(role)) {
            return pjp.proceed();
        }

        Set<String> perms = permissionService.getPermissionsByRole(role);
        if (perms.contains(requirePermission.value())) {
            return pjp.proceed();
        }
        throw new BaseException("权限不足");
    }
}