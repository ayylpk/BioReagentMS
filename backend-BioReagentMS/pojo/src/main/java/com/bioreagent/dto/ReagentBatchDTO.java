package com.bioreagent.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import jakarta.validation.constraints.NotNull;
import java.time.LocalDate;

/**
 * 批次入库 / 更新用的 DTO
 */
@Data
@AllArgsConstructor
@NoArgsConstructor
public class ReagentBatchDTO {

    private Long id;

    @NotNull(message = "试剂ID不能为空")
    private Long reagentId;

    @NotNull(message = "批号不能为空")
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
}
