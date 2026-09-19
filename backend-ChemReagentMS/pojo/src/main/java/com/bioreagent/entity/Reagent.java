package com.bioreagent.entity;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.io.Serializable;
import java.time.LocalDate;

/**
 * 试剂主表 —— 只放"试剂是什么"的不变信息
 * 批号、库存、价格、效期等流转数据统一去 reagent_batch 表
 */
@Data
@AllArgsConstructor
@NoArgsConstructor
public class Reagent implements Serializable {

    private static final long serialVersionUID = 1L;

    private Long id;                    // 试剂ID
    private String name;                // 名称
    private String casNumber;           // CAS号
    private String specification;       // 规格
    private String purity;              // 纯度
    private Long categoryId;            // 分类ID
    private Integer totalStock;             // 所有批次合计库存
    private String unit;                // 单位
    private String storageCondition;    // 存储条件
    private Integer safetyStockThreshold; // 安全库存阈值
    private Integer warningAdvanceDays; // 预警提前天数
    private Integer status;             // 0-启用 1-禁用
    private LocalDate createTime;       // 创建时间
}
