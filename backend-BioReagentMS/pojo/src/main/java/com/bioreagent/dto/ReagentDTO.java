package com.bioreagent.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import jakarta.validation.constraints.NotBlank;

/**
 * 试剂主表 DTO —— 不含批次字段
 */
@Data
@AllArgsConstructor
@NoArgsConstructor
public class ReagentDTO {

    private Long id;

    @NotBlank(message = "试剂名称不能为空")
    private String name;

    private String casNumber;
    private String specification;
    private String purity;
    private Long categoryId;
    private Integer total;
    private String unit;
    private String storageCondition;
    private Integer safetyStockThreshold;
    private Integer warningAdvanceDays;
    private Integer status;
}


