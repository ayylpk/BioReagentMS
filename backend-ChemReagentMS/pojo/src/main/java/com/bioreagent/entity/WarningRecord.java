package com.bioreagent.entity;


import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

@Data
@AllArgsConstructor
@NoArgsConstructor
/**
 * 警告记录实体类
 * 用于记录试剂库存的预警信息，如过期预警、库存不足预警等
 */
public class WarningRecord {
    /** 主键ID */
    private Integer id;
    /** 试剂ID */
    private Integer reagentId;
    /** 试剂名称 */
    private String reagentName;
    /** 试剂批号 */
    private String reagentBatch;
    /** 警告类型（如：过期预警、库存不足、低库存等） */
    private String warningType;
    /** 预警触发时间 */
    private LocalDateTime triggerTime;
    /** 预警状态（如：0-未处理，1-已处理） */
    private Integer status;
    /** 处理时间 */
    private LocalDateTime resolveTime;
    /** 处理人ID */
    private Integer resolvedBy;
    /** 当前库存（联表 reagent.total_stock） */
    private Integer currentStock;
    /** 安全库存阈值（联表 reagent.safety_stock_threshold） */
    private Integer safetyStockThreshold;
}
