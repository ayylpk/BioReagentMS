package com.bioreagent.QueryParam;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 批次库存分页查询参数
 */
@Data
@AllArgsConstructor
@NoArgsConstructor
public class ReagentBatchQueryParam {
    private Integer page = 1;
    private Integer pageSize = 10;
    private Long reagentId;             // 按试剂ID筛选
    private String batchNumber;         // 按批号精确筛选（预警等后端逻辑使用）
    private String keyword;             // 批号或试剂名称模糊搜索（前端搜索框）
    private Integer status;             // 按状态筛选
}
