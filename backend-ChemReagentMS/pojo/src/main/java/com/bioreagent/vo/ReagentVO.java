package com.bioreagent.vo;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 试剂主表 VO —— 总库存从批次表汇总
 */
@Data
@AllArgsConstructor
@NoArgsConstructor
public class ReagentVO {

    private Long id;                    // 试剂ID
    private String name;                // 名称
    private String casNumber;           // CAS号
    private String specification;       // 规格
    private String purity;              // 纯度
    private Long categoryId;            // 分类ID
    private String unit;                // 单位
    private String storageCondition;    // 存储条件
    private Integer safetyStockThreshold; // 安全库存阈值
    private Integer warningAdvanceDays; // 预警提前天数
    private Integer status;             // 状态

    /** 所有批次合计库存，由 Mapper 子查询算出 */
    private Integer total;

}
