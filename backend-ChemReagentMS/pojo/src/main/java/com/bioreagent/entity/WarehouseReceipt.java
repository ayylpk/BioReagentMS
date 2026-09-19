package com.bioreagent.entity;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.io.Serializable;
import java.time.LocalDateTime;

@Data
@AllArgsConstructor
@NoArgsConstructor
public class WarehouseReceipt implements Serializable {

    private static final long serialVersionUID = 1L;

    private Long id; // 入库单ID

    private String receiptNumber; // 入库单号

    private Long reagentId; // 试剂ID

    private String reagentName; // 试剂名称

    private Integer quantity; // 入库数量

    private Double unitPrice; // 单价

    private Integer operatorId; // 操作人ID

    private String operatorName; // 操作人姓名

    private LocalDateTime receiptTime; // 入库时间

    private String remark; // 备注
}
