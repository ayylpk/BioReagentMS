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
public class WarehouseReceiptDTO implements Serializable {

    private static final long serialVersionUID = 1L;

    private Long id;

    @NotBlank(message = "入库单号不能为空")
    private String receiptNumber;

    @NotNull(message = "试剂ID不能为空")
    private Long reagentId;

    private String reagentName;

    @NotNull(message = "入库数量不能为空")
    private Integer quantity;

    private Double unitPrice; // 单价

    private Integer operatorId;

    private String operatorName;

    private LocalDateTime receiptTime;

    private String remark;
}
