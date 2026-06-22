package com.bioreagent.QueryParam;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 试剂分页查询参数
 */
@Data
@AllArgsConstructor
@NoArgsConstructor
public class ReagentQueryParam {
    private Integer page = 1;
    private Integer pageSize = 10;
    private String keyword;           // 名称或CAS号模糊搜索
    private Long categoryId;          // 分类ID
    private Integer status;           // 状态
    private String supplierId;        // 供应商ID
}
