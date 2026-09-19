package com.bioreagent.vo;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 库存概览 VO — 仪表盘顶部汇总数据
 */
@Data
@AllArgsConstructor
@NoArgsConstructor
public class InventoryOverviewVO {
    private Integer reagentTypeCount;   // 试剂种类总数
    private Integer totalStock;         // 库存总量
    private Integer shortageWarnings;   // 库存不足预警数
    private Integer expiryWarnings;     // 效期临近预警数
    private Integer activeBatchCount;   // 在库批次总数
}
