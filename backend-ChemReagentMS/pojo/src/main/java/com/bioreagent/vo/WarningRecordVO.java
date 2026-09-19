package com.bioreagent.vo;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

/**
 * 预警记录 VO —— 前端展示用
 */
@Data
@AllArgsConstructor
@NoArgsConstructor
public class WarningRecordVO {

    private Integer id;
    private Integer reagentId;
    private String reagentName;
    private String reagentBatch;
    /** 预警类型：EXPIRY-过期预警, SHORTAGE-库存不足 */
    private String warningType;
    /** 预警触发时间 */
    private LocalDateTime triggerTime;
    /** 预警状态：0-未处理, 1-已处理 */
    private Integer status;
    /** 处理时间 */
    private LocalDateTime resolveTime;
    /** 处理人ID */
    private Integer resolvedBy;

    /** 当前该试剂总库存（供二次核验参考） */
    private Integer currentStock;
    /** 安全库存阈值（低于此值触发预警） */
    private Integer safetyStockThreshold;
}
