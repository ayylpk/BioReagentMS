package com.bioreagent.vo;


import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

@Data
@AllArgsConstructor
@NoArgsConstructor
public class InventoryReportVO {
    private Integer reagentTypeCount;   // 试剂种类总数
    private Integer totalStock;         // 库存总量
    private Integer shortageWarnings;   // 库存不足预警数
    private Integer expiryWarnings;     // 效期临近预警数
    private Integer activeBatchCount;   // 在库批次总数
    private List<ReagentVO> reagentList;//试剂列表
}

