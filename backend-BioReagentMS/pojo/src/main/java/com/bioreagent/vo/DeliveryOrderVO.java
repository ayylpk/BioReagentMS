package com.bioreagent.vo;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.io.Serializable;
import java.time.LocalDateTime;

@Data
@AllArgsConstructor
@NoArgsConstructor
public class DeliveryOrderVO implements Serializable {

    private static final long serialVersionUID = 1L;

    private Integer id; // 出库单ID

    private String orderNumber; // 出库单号

    private Integer reagentId; // 试剂ID

    private String reagentName; // 试剂名称

    private Long batchId; // 出库批次ID

    private String batchNumber; // 批号（批次表关联查出）

    private Integer quantity; // 出库数量

    private String operatorName; // 操作人姓名

    private LocalDateTime deliveryTime; // 出库时间

    private Integer status; // 状态：-1-已取消，0-待审核，1-已通过，2-已拒绝

    private String approverName; // 审核人姓名

    private LocalDateTime approvalTime; // 审核时间

    private String rejectionReason; // 拒绝原因

    private String remark; // 备注
}
