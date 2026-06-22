package com.bioreagent.entity;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.io.Serializable;
import java.time.LocalDate;
import java.time.LocalDateTime;

/**
 * 试剂批次库存表
 * 每入库一批就新增一行，同一试剂关联 reagent_id
 */
@Data
@AllArgsConstructor
@NoArgsConstructor
public class ReagentBatch implements Serializable {

    private static final long serialVersionUID = 1L;

    private Long id;                    // 主键
    private Long reagentId;             // 关联试剂主表
    private String batchNumber;         // 批号
    private LocalDate productionDate;   // 生产日期
    private LocalDate expiryDate;       // 失效日期
    private Integer openedExpiryDays;   // 开封后有效天数
    private LocalDate openedDate;       // 开封日期，null = 未开封
    private Integer initialQuantity;    // 入库数量
    private Integer currentQuantity;    // 当前余量
    private Double unitPrice;           // 采购单价
    private String storageLocation;     // 存储位置
    private String supplierId;          // 供应商ID
    private Integer status;             // 0-在库(未开封) 1-已开封 2-已用完 3-已过期
    private String remark;              // 备注
    private LocalDateTime createTime;   // 入库时间
}
