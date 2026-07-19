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

    private static final String[] NAME_FIELDS = {
        "name", "reagentName", "batchNumber", "orderNumber", "receiptNumber", "username"
    };

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
        String module = parseModule(signature);
        String action = module + parseAction(signature);

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


    private String parseModule(MethodSignature signature) {
        for (Annotation ann : signature.getMethod().getAnnotations()) {
            try {
                return (String) ann.getClass().getMethod("module").invoke(ann);
            } catch (Exception ignored) {}
        }
        return "未知";
    }

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

            // String  直接作为目标名返回
            if (arg instanceof String) {
                return arg.toString();
            }

            // Number  跳过（通常是 id），不做为名称
            if (arg instanceof Number) {
                continue;
            }

            String name = tryExtractName(arg);
            if (name != null && !name.isEmpty()) {
                return name;
            }

            String s = arg.toString();
            if (s.length() > 60) s = s.substring(0, 57) + "...";
            return s;
        }
        return "";
    }

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

    private Integer extractQuantity(Object[] args) {
        if (args == null) return null;
        Integer lastNumber = null;
        for (Object arg : args) {
            if (arg == null) continue;
            String clsName = arg.getClass().getSimpleName();
            if (clsName.contains("BindingResult") || clsName.contains("HttpServletRequest")
                    || clsName.contains("HttpServletResponse")) {
                continue;
            }

            if (arg instanceof Integer || arg instanceof Long) {
                lastNumber = ((Number) arg).intValue();
                continue;
            }

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
        return lastNumber;
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
