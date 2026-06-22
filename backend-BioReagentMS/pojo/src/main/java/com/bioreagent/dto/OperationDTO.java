package com.bioreagent.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@AllArgsConstructor
@NoArgsConstructor
public class OperationDTO {

    private Long operatorId;        // 操作人ID
    private String module;          // 模块名
    private String action;          // 操作类型
    private String targetId;        // 目标数据ID
    private String detail;          // 详细描述
}
