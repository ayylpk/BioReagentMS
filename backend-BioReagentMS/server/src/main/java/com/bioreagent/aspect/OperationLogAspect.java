package com.bioreagent.aspect;

import com.bioreagent.context.BaseContext;
import com.bioreagent.entity.Operation;
import com.bioreagent.entity.User;
import com.bioreagent.mapper.OperationMapper;
import com.bioreagent.mapper.UserMapper;
import lombok.extern.slf4j.Slf4j;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.aspectj.lang.reflect.MethodSignature;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.lang.annotation.Annotation;
import java.lang.reflect.Field;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.Collection;

@Slf4j
@Aspect
@Component
public class OperationLogAspect {

    @Autowired
    private OperationMapper operationMapper;

    @Autowired
    private UserMapper userMapper;

    /** 常见的"名称"字段候选 */
    private static final String[] NAME_FIELDS = {
        "name", "reagentName", "batchNumber", "orderNumber", "receiptNumber", "username"
    };

    /** 常见的"数量"字段候选 */
    private static final String[] QUANTITY_FIELDS = {
        "quantity", "initialQuantity", "total", "currentQuantity"
    };

    @Around("@annotation(com.bioreagent.annotation.OperationAdd) " +
            "|| @annotation(com.bioreagent.annotation.OperationDelete) " +
            "|| @annotation(com.bioreagent.annotation.OperationUpdate) " +
            "|| @annotation(com.bioreagent.annotation.OperationAudit)")
    public Object around(ProceedingJoinPoint joinPoint) throws Throwable {
        LocalDateTime startTime = LocalDateTime.now();

        // 1. 执行目标方法
        Object result = joinPoint.proceed();

        // 2. 解析注解信息
        MethodSignature signature = (MethodSignature) joinPoint.getSignature();
        String action = parseAction(signature);
        String module = parseModule(signature);

        // 3. 从方法参数中提取目标名和数量
        Object[] args = joinPoint.getArgs();
        String targetName = extractTargetName(args);
        Integer quantity = extractQuantity(args);

        // 4. 查操作人姓名
        Long userId = BaseContext.getCurrentId();
        String operatorName = "";
        if (userId != null) {
            try {
                User user = userMapper.getById(userId.intValue());
                if (user != null && user.getName() != null) {
                    operatorName = user.getName();
                }
            } catch (Exception e) {
                log.warn("查询操作人姓名失败 userId={}", userId, e);
            }
        }

        // 5. 构建 detail：操作人姓名 + 操作 + 操作物品及数目
        StringBuilder detail = new StringBuilder();
        if (!operatorName.isEmpty()) {
            detail.append(operatorName);
        } else {
            detail.append(userId != null ? "用户" + userId : "系统");
        }
        detail.append(" ").append(action);
        if (targetName != null && !targetName.isEmpty()) {
            detail.append(" ").append(targetName);
        }
        if (quantity != null && quantity > 0) {
            detail.append(" ×").append(quantity);
        }

        // 6. 截断过长文本，避免超出数据库字段
        String targetIdVal = targetName != null ? targetName : "";
        if (targetIdVal.length() > 100) {
            targetIdVal = targetIdVal.substring(0, 97) + "...";
        }
        String detailVal = detail.toString();
        if (detailVal.length() > 500) {
            detailVal = detailVal.substring(0, 497) + "...";
        }

        // 7. 入库
        Operation op = new Operation();
        op.setOperatorId(userId);
        op.setModule(module);
        op.setAction(action);
        op.setTargetId(targetIdVal);
        op.setDetail(detailVal);
        op.setCreateTime(startTime);
        operationMapper.insert(op);

        log.info("[操作日志] module={} | action={} | target={} | operatorId={} | time={}",
                module, action, targetIdVal, userId,
                startTime.format(DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss")));

        return result;
    }

    /** 从注解中提取 module */
    private String parseModule(MethodSignature signature) {
        for (Annotation ann : signature.getMethod().getAnnotations()) {
            try {
                // 用反射调 ann.module()
                return (String) ann.getClass().getMethod("module").invoke(ann);
            } catch (Exception ignored) {}
        }
        return "未知";
    }

    /** 从注解中提取操作类型 */
    private String parseAction(MethodSignature signature) {
        for (Annotation ann : signature.getMethod().getAnnotations()) {
            String name = ann.annotationType().getSimpleName();
            if ("OperationAdd".equals(name)) return "新增";
            if ("OperationDelete".equals(name)) return "删除";
            if ("OperationUpdate".equals(name)) return "修改";
            if ("OperationAudit".equals(name)) return "审批";
        }
        return "未知";
    }

    /** 从方法参数中提取目标名称 */
    private String extractTargetName(Object[] args) {
        if (args == null || args.length == 0) return "";

        // 先过滤掉框架参数
        for (Object arg : args) {
            if (arg == null) continue;
            String clsName = arg.getClass().getSimpleName();
            if (clsName.contains("BindingResult")
                    || clsName.contains("HttpServletRequest")
                    || clsName.contains("HttpServletResponse")) {
                continue;
            }

            // List/Collection → 批量操作
            if (arg instanceof Collection) {
                int size = ((Collection<?>) arg).size();
                if (size > 0) {
                    Object first = ((Collection<?>) arg).iterator().next();
                    String itemName = tryExtractName(first);
                    if (itemName != null && !itemName.isEmpty()) {
                        return size == 1 ? itemName : (itemName + " 等" + size + "条");
                    }
                    return "批量 " + size + " 条";
                }
                continue;
            }

            // 基本类型 / 包装类 → 直接返回
            if (arg instanceof String || arg instanceof Number) {
                return arg.toString();
            }

            // DTO —— 尝试反射提取名称字段
            String name = tryExtractName(arg);
            if (name != null && !name.isEmpty()) {
                return name;
            }

            // 实在找不到 → toString 截断
            String s = arg.toString();
            if (s.length() > 60) s = s.substring(0, 57) + "...";
            return s;
        }
        return "";
    }

    /** 试从对象中提取名称字段 */
    private String tryExtractName(Object obj) {
        if (obj == null) return null;
        for (String fieldName : NAME_FIELDS) {
            try {
                Field f = findField(obj.getClass(), fieldName);
                if (f != null) {
                    f.setAccessible(true);
                    Object val = f.get(obj);
                    if (val != null) return val.toString();
                }
            } catch (Exception ignored) {}
        }
        return null;
    }

    /** 从方法参数中提取数量 */
    private Integer extractQuantity(Object[] args) {
        if (args == null) return null;
        for (Object arg : args) {
            if (arg == null) continue;
            String clsName = arg.getClass().getSimpleName();
            if (clsName.contains("BindingResult") || clsName.contains("HttpServletRequest")
                    || clsName.contains("HttpServletResponse")) {
                continue;
            }

            // 基本类型直接就是数量
            if (arg instanceof Integer || arg instanceof Long) {
                return ((Number) arg).intValue();
            }

            // DTO —— 反射找数量字段
            for (String fieldName : QUANTITY_FIELDS) {
                try {
                    Field f = findField(arg.getClass(), fieldName);
                    if (f != null) {
                        f.setAccessible(true);
                        Object val = f.get(arg);
                        if (val instanceof Number) {
                            return ((Number) val).intValue();
                        }
                    }
                } catch (Exception ignored) {}
            }
        }
        return null;
    }

    private Field findField(Class<?> clazz, String fieldName) {
        Class<?> current = clazz;
        while (current != null && current != Object.class) {
            try {
                return current.getDeclaredField(fieldName);
            } catch (NoSuchFieldException e) {
                current = current.getSuperclass();
            }
        }
        return null;
    }
}
