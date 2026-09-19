package com.bioreagent.vo;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

@Data
@AllArgsConstructor
@NoArgsConstructor
public class OperationVO {
    private Long id;
    private Long operatorId;
    private String operatorName;    // 操作人姓名（JOIN user 表）
    private String module;          // 模块：试剂 / 批次 / 入库 / 出库
    private String action;          // 操作类型：新增 / 删除 / 修改 / 审批
    private String targetId;        // 目标名称
    private String detail;          // 详情：操作人姓名 + 操作 + 物品及数目
    private LocalDateTime createTime;
}
