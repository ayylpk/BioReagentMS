package com.bioreagent.vo;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

/**
 * 入库记录明细 VO — Excel 导出一行
 */
@Data
@AllArgsConstructor
@NoArgsConstructor
public class InboundRecordVO {
    private String receiptNumber;   // 入库单号
    private String reagentName;     // 试剂名称
    private Integer quantity;       // 入库数量
    private Double unitPrice;       // 单价
    private Double totalAmount;     // 金额
    private String operatorName;    // 操作人
    private LocalDateTime receiptTime; // 入库时间
    private String remark;          // 备注
}
