package com.bioreagent.entity;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.io.Serializable;
import java.time.LocalDateTime;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class DeliveryOrder implements Serializable {

    private static final long serialVersionUID = 1L;

    private Integer id; // 出库单ID

    private String orderNumber; // 出库单号

    private Integer reagentId; // 试剂ID

    private String reagentName; // 试剂名称

    private Long batchId; // 出库批次ID（关联 reagent_batch）

    private Integer quantity; // 出库数量

    private Integer operatorId; // 操作人ID

    private String operatorName; // 操作人姓名

    private Integer status; // 状态：-1-已取消，0-待审核，1-已通过，2-已拒绝

    private Integer approverId; // 审核人ID

    private String approverName; // 审核人姓名

    private LocalDateTime deliveryTime; // 出库时间

    private LocalDateTime approvalTime; // 审核时间

    private String rejectionReason; // 拒绝原因

    private String remark; // 备注

}
