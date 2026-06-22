package com.bioreagent.annotation;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 标记"新增"操作，切面自动记录操作日志
 */
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface OperationAdd {
    /** 操作所属模块：试剂 / 批次 / 入库 / 出库 */
    String module();
}
