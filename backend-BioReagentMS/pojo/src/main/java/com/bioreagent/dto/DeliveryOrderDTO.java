package com.bioreagent.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.io.Serializable;
import java.time.LocalDateTime;

@Data
@AllArgsConstructor
@NoArgsConstructor
public class DeliveryOrderDTO implements Serializable {

    private static final long serialVersionUID = 1L;

    private Integer id;

    @NotBlank(message = "出库单号不能为空")
    private String orderNumber;

    @NotNull(message = "试剂ID不能为空")
    private Integer reagentId;

    private String reagentName;

    private Long batchId; // 出库批次ID

    @NotNull(message = "出库数量不能为空")
    private Integer quantity;

    private Integer status;

    private Integer approverId;

    private LocalDateTime deliveryTime; // 出库时间

    private LocalDateTime approvalTime;

    private String rejectionReason;

    private String remark;

    private LocalDateTime createTime; // 创建时间
}
