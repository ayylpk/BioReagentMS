package com.bioreagent.QueryParam;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@AllArgsConstructor
@NoArgsConstructor
public class WarehouseReceiptQueryParam {
    private Integer page = 1;
    private Integer pageSize = 10;
    private Long id;                    // 入库单ID
    private String reagentName;         // 试剂名称（模糊查询）
    private String receiptNumber;       // 入库单号
    private Integer operatorId;         // 操作人ID
}
