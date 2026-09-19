package com.bioreagent.QueryParam;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 出库单分页查询参数
 */
@Data
@AllArgsConstructor
@NoArgsConstructor
public class DeliveryOrderQueryParam {
    private Integer page = 1;           // 页码
    private Integer pageSize = 10;      // 每页条数
    private Integer id;                 // 出库单ID
    private String orderNumber;         // 出库单号
    private String reagentName;         // 试剂名称（模糊查询）
    private Integer operatorId;         // 操作人ID
    private Integer status;             // 状态：-1-已取消，0-待审核，1-已通过，2-已拒绝
}
