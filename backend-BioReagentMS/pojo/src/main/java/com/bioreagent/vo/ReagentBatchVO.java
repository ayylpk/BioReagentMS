package com.bioreagent.vo;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDate;
import java.time.LocalDateTime;

/**
 * 批次库存返回给前端的 VO
 */
@Data
@AllArgsConstructor
@NoArgsConstructor
public class ReagentBatchVO {

    private Long id;
    private Long reagentId;
    private String reagentName;         // 关联查出来的试剂名称
    private String batchNumber;
    private LocalDate productionDate;
    private LocalDate expiryDate;
    private Integer openedExpiryDays;
    private LocalDate openedDate;
    private Integer initialQuantity;
    private Integer currentQuantity;
    private Double unitPrice;
    private String storageLocation;
    private String supplierId;
    private Integer status;
    private String remark;
    private LocalDateTime createTime;
}
