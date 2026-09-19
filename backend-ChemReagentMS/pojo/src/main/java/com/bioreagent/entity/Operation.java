package com.bioreagent.entity;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

/**
 * 操作日志实体
 */
@Data
@AllArgsConstructor
@NoArgsConstructor
public class Operation {
    private Long id;                // 主键
    private Long operatorId;        // 操作人ID
    private String module;          // 模块名，如 "试剂管理"
    private String action;          // 操作类型，如 "新增"
    private String targetId;        // 操作的目标数据ID
    private String detail;          // 详细描述
    private LocalDateTime createTime; // 操作时间
}
